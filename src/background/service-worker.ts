import type { AppState, AutomationSession, BankDiffResult, BankSnapshotItem, ContentInspection, DryRunItemResult, DryRunResult, QueueItem, RuntimeMessage, RuntimeStatus, Settings } from '../domain/models';
import { createHistoricalSession, defaultSettings } from '../domain/models';
import { classifyBankDiff, mergeSelectedDiffItems } from '../domain/bank-diff';
import { fingerprintTweet } from '../domain/content-fingerprint';
import { runPreflight } from '../domain/preflight';
import { hasFutureRecoveryAlarm, normalizeRecovery } from '../domain/recovery';
import { canStartItem, getNextPendingItem, getNextRunnableItem, isTerminalItem } from '../domain/state-machine';
import { extractLinksFromValues } from '../extraction/bank-parser';
import { getNextAllowedPublishingTime } from '../domain/scheduling';
import { addAttempt, archiveBank, claimAutomationOwner, clearWorkspaceProfile, createBank, createWorkspace, deleteBank, deleteWorkspace, exportBackup, getAutomationOwner, getHistoricalSessions, getMeta, getSettings, getState as getActiveState, getWorkspaceSettings, getWorkspaceState, listBanks, listWorkspaces, releaseAutomationOwner, restoreBank, restoreBackup, saveHistoricalSession, saveQueue, saveSession, saveSettings, setActiveWorkspace, updateBank, updateHistoricalSession, updateState as updateActiveState, updateWorkspace, updateWorkspaceProfile, updateWorkspaceState, archiveWorkspace, restoreWorkspace, validateBackup } from '../storage/storage-repository';

const ALARM_NAME = 'x-queue-next-item';
const SCHEDULE_ALARM_NAME = 'x-queue-scheduled-start';
const bankDiffs = new Map<string, BankDiffResult>();
const AUTOMATION_TAB_KEY = 'automationTabId';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const injectedContentTabs = new Set<number>();
const contentInjectionInFlight = new Map<number, Promise<void>>();
const DRY_RUN_KEY = 'xPilotDryRunResult';
let dryRunStopRequested = false;

async function getState(): Promise<AppState> {
  const owner = await getAutomationOwner();
  return owner ? getWorkspaceState(owner) : getActiveState();
}

async function updateRuntimeState(mutator: (state: AppState) => AppState): Promise<AppState> {
  const owner = await getAutomationOwner();
  if (!owner) return updateActiveState(mutator);
  const saved = await updateWorkspaceState(owner, (state) => ({ ...state, ...mutator(state), workspaceId: owner }));
  return { workspaceId: saved.workspaceId, queue: saved.queue, session: saved.session, history: saved.history };
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') injectedContentTabs.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedContentTabs.delete(tabId);
  contentInjectionInFlight.delete(tabId);
  void getState().then((state) => {
    if (state.session?.automationTabId !== tabId) return;
    void chrome.storage.local.remove(AUTOMATION_TAB_KEY);
    void updateRuntimeState((current) => current.session?.automationTabId === tabId
      ? { ...current, session: { ...current.session, automationTabId: undefined, updatedAt: Date.now() } }
      : current);
  }).catch(() => undefined);
});

async function broadcast(state?: AppState) {
  const snapshot = state ?? await getState();
  await chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: snapshot }).catch(() => undefined);
  await updateBadge(snapshot);
}

async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const automationWorkspaceId = await getAutomationOwner();
  const state = await getState();
  const session = state.session;
  const activeEngine = session?.status === 'RUNNING' || session?.status === 'WAITING' || session?.status === 'PAUSED';
  if (!activeEngine || !session?.automationTabId) {
    return { engineStatus: session?.status ?? 'IDLE', connection: 'NOT_REQUIRED', automationWorkspaceId, checkedAt: Date.now() };
  }
  try {
    await chrome.tabs.get(session.automationTabId);
    return { engineStatus: session.status, connection: 'CONNECTED', automationTabId: session.automationTabId, automationWorkspaceId, checkedAt: Date.now() };
  } catch {
    return { engineStatus: session.status, connection: 'DISCONNECTED', automationTabId: session.automationTabId, automationWorkspaceId, checkedAt: Date.now() };
  }
}

async function notifyEvent(title: string, message: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.notificationsEnabled || !chrome.notifications) return;
  await chrome.notifications.create(`x-pilot-${Date.now()}`, { type: 'basic', iconUrl: 'icons/icon128.png', title, message });
}

async function updateBadge(state?: AppState): Promise<void> {
  const settings = await getSettings();
  const snapshot = state ?? await getState();
  let text = '';
  if (settings.badgeMode === 'COUNT') text = String(snapshot.queue.filter((item) => item.status === 'PENDING' || item.status === 'FAILED').length || '');
  if (settings.badgeMode === 'STATUS') text = snapshot.session?.status === 'RUNNING' ? '▶' : snapshot.session?.status === 'PAUSED' ? 'Ⅱ' : snapshot.session?.status === 'FAILED' ? '!' : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: snapshot.session?.status === 'FAILED' ? '#b42318' : '#175fbe' });
}

async function recoverPersistedState(): Promise<AppState> {
  const current = await getState();
  const recovered = normalizeRecovery(current);
  const changed = JSON.stringify(recovered) !== JSON.stringify(current);
  const state = changed ? await updateRuntimeState(() => recovered) : current;
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.clear(SCHEDULE_ALARM_NAME);
  if (state.session?.status === 'SCHEDULED' && state.session.scheduledStartAt && state.session.scheduledStartAt > Date.now()) await chrome.alarms.create(SCHEDULE_ALARM_NAME, { when: state.session.scheduledStartAt, persistAcrossSessions: true });
  if (hasFutureRecoveryAlarm(state)) await chrome.alarms.create(ALARM_NAME, { when: state.session!.nextRunAt!, persistAcrossSessions: true });
  await updateBadge(state);
  await broadcast(state);
  return state;
}

async function syncHistoricalSession(state: AppState, status?: 'RUNNING' | 'PAUSED' | 'WAITING' | 'COMPLETED' | 'STOPPED' | 'FAILED', failureReason?: string): Promise<void> {
  const session = state.session;
  if (!state.workspaceId || !session?.historicalSessionId) return;
  await updateHistoricalSession(state.workspaceId, session.historicalSessionId, {
    ...(status ? { status } : {}),
    ...(status === 'COMPLETED' || status === 'STOPPED' || status === 'FAILED' ? { completedAt: Date.now() } : {}),
    ...(failureReason ? { failureReason } : {}),
    totalItems: state.queue.length,
    publishedCount: state.queue.filter((item) => item.status === 'PUBLISHED' || item.status === 'PUBLISHED_UNVERIFIED').length,
    failedCount: state.queue.filter((item) => item.status === 'FAILED').length,
    skippedCount: state.queue.filter((item) => item.status === 'SKIPPED').length,
  });
}

async function getOrCreateAutomationTab(session: AutomationSession): Promise<number> {
  if (session.automationTabId) {
    try {
      await chrome.tabs.get(session.automationTabId);
      return session.automationTabId;
    } catch { /* recreate below */ }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (!tab.id) throw new Error('AUTOMATION_TAB_CREATE_FAILED');
  await updateRuntimeState((state) => ({ ...state, session: state.session ? { ...state.session, automationTabId: tab.id, updatedAt: Date.now() } : null }));
  await chrome.storage.local.set({ [AUTOMATION_TAB_KEY]: tab.id });
  return tab.id;
}

async function waitForTabLoad(tabId: number, timeoutMs = 20000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timer: number | undefined;
    let settled = false;
    const cleanup = () => { chrome.tabs.onUpdated.removeListener(listener); if (timer) clearTimeout(timer); };
    const finish = () => { if (settled) return; settled = true; cleanup(); resolve(); };
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') finish(); }).catch(() => undefined);
    timer = setTimeout(() => { cleanup(); reject(new Error('TAB_LOAD_TIMEOUT')); }, timeoutMs) as unknown as number;
  });
}

async function getPreviousActiveTabId(tabId: number): Promise<number | undefined> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTab?.id && activeTab.id !== tabId ? activeTab.id : undefined;
}

async function activateAutomationTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
}

async function restoreActiveTab(tabId: number | undefined): Promise<void> {
  if (tabId) await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
}

async function closeAutomationTabIfConfigured(session: AutomationSession): Promise<AppState> {
  const tabId = session.automationTabId;
  const shouldClose = Boolean(tabId && (session.closeTabOnComplete || !session.keepAutomationTabOpen));
  if (!tabId || !shouldClose) return getState();
  await chrome.tabs.remove(tabId).catch(() => undefined);
  await chrome.storage.local.remove(AUTOMATION_TAB_KEY);
  return updateRuntimeState((state) => state.session?.automationTabId === tabId
    ? { ...state, session: { ...state.session, automationTabId: undefined, updatedAt: Date.now() } }
    : state);
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (injectedContentTabs.has(tabId)) return;
  const existing = contentInjectionInFlight.get(tabId);
  if (existing) return existing;
  const injection = chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    .then(() => { injectedContentTabs.add(tabId); })
    .finally(() => { contentInjectionInFlight.delete(tabId); });
  contentInjectionInFlight.set(tabId, injection);
  return injection;
}

async function inspectTab(tabId: number): Promise<ContentInspection> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'X_INSPECT' });
  } catch {
    await ensureContentScript(tabId);
    return await chrome.tabs.sendMessage(tabId, { type: 'X_INSPECT' });
  }
}

function classifyDryRunInspection(inspection: ContentInspection): DryRunItemResult['status'] {
  if (inspection.pageKind === 'LOGIN') return 'LOGIN_REQUIRED';
  if (inspection.pageKind === 'CHALLENGE') return 'CHALLENGE_DETECTED';
  if (!inspection.contentPresent) return 'CONTENT_MISSING';
  if (!inspection.composerFound || !inspection.postButtonFound || !inspection.postButtonEnabled) return 'POST_BUTTON_NOT_FOUND';
  return 'READY';
}

async function saveDryRun(result: DryRunResult): Promise<DryRunResult> {
  await chrome.storage.local.set({ [DRY_RUN_KEY]: result });
  await broadcast();
  return result;
}

async function runDryRun(mode: 'FIRST_ITEM' | 'ENTIRE_QUEUE', workspaceId?: string): Promise<DryRunResult> {
  const state = await (workspaceId ? getWorkspaceState(workspaceId) : getState());
  const selected = state.queue.filter((item) => item.status === 'PENDING' || item.status === 'FAILED').slice(0, mode === 'FIRST_ITEM' ? 1 : undefined);
  const result: DryRunResult = { id: crypto.randomUUID(), workspaceId: state.workspaceId, mode, status: 'RUNNING', startedAt: Date.now(), total: selected.length, checked: 0, ready: 0, failed: 0, items: [] };
  dryRunStopRequested = false;
  await saveDryRun(result);
  let tabId: number | undefined;
  let previousActiveTabId: number | undefined;
  try {
    if (!selected.length) return saveDryRun({ ...result, status: 'COMPLETED', completedAt: Date.now() });
    if (!state.session) throw new Error('AUTOMATION_SESSION_NOT_FOUND');
    tabId = await getOrCreateAutomationTab(state.session);
    previousActiveTabId = await getPreviousActiveTabId(tabId);
    for (const item of selected) {
      if (dryRunStopRequested) break;
      const started = Date.now();
      let itemResult: DryRunItemResult;
      try {
        const parsed = new URL(item.targetUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || !/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(parsed.hostname)) throw new Error('INVALID_URL');
        await chrome.tabs.update(tabId, { url: item.targetUrl, active: false });
        await waitForTabLoad(tabId);
        await activateAutomationTab(tabId);
        await wait(300);
        const inspection = await inspectTab(tabId);
        itemResult = { queueItemId: item.id, position: item.position, targetUrl: item.targetUrl, status: classifyDryRunInspection(inspection), checkedAt: Date.now(), durationMs: Date.now() - started, pageKind: inspection.pageKind, composerFound: inspection.composerFound, contentPresent: inspection.contentPresent, postButtonFound: inspection.postButtonFound, postButtonEnabled: inspection.postButtonEnabled, reason: inspection.reason };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        itemResult = { queueItemId: item.id, position: item.position, targetUrl: item.targetUrl, status: reason === 'INVALID_URL' ? 'INVALID_URL' : 'ERROR', checkedAt: Date.now(), durationMs: Date.now() - started, pageKind: 'ERROR', composerFound: false, contentPresent: false, postButtonFound: false, postButtonEnabled: false, reason, error: reason };
      }
      result.items.push(itemResult);
      result.checked = result.items.length;
      result.ready = result.items.filter((entry) => entry.status === 'READY').length;
      result.failed = result.checked - result.ready;
      result.currentItemId = item.id;
      await saveDryRun({ ...result });
    }
    return saveDryRun({ ...result, status: dryRunStopRequested ? 'STOPPED' : 'COMPLETED', completedAt: Date.now(), currentItemId: undefined });
  } catch {
    return saveDryRun({ ...result, status: 'FAILED', completedAt: Date.now(), currentItemId: undefined });
  } finally {
    await restoreActiveTab(previousActiveTabId);
  }
}

async function waitForPublishReady(tabId: number, timeoutMs = 25000, intervalMs = 500): Promise<ContentInspection> {
  const deadline = Date.now() + timeoutMs;
  let lastInspection: ContentInspection | undefined;
  while (Date.now() < deadline) {
    lastInspection = await inspectTab(tabId);
    if (lastInspection.ok) return lastInspection;
    if (lastInspection.pageKind === 'LOGIN' || lastInspection.pageKind === 'CHALLENGE' || lastInspection.pageKind === 'UNKNOWN') {
      throw new Error(lastInspection.reason ?? 'PUBLISH_CONTROLS_NOT_READY');
    }
    await wait(intervalMs);
  }
  throw new Error(lastInspection?.reason ?? 'PUBLISH_CONTROLS_NOT_READY');
}

async function assertOperationActive(itemId: string, operationId: string): Promise<void> {
  const state = await getState();
  const item = state.queue.find((candidate) => candidate.id === itemId);
  if (state.session?.status !== 'RUNNING' || item?.operationId !== operationId) throw new Error('AUTOMATION_INTERRUPTED');
}

async function processCurrentItem(): Promise<void> {
  const state = await getState();
  const session = state.session;
  if (!session || session.status !== 'RUNNING' || !session.currentItemId) return;
  const item = state.queue.find((candidate) => candidate.id === session.currentItemId);
  if (!item || !canStartItem(item.status)) return;
  const profile = await getWorkspaceSettings(state.workspaceId ?? session.workspaceId ?? (await getMeta()).activeWorkspaceId);
  const allowedAt = getNextAllowedPublishingTime(Date.now(), profile.timezone, profile.publishingWindows);
  if (allowedAt && allowedAt > Date.now() + 500) {
    const waiting = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'WAITING', nextRunAt: allowedAt, updatedAt: Date.now() } : null }));
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, { when: allowedAt, persistAcrossSessions: true });
    await notifyEvent('X-Pilot: خارج نافذة النشر', `سيستأنف النشر في ${new Date(allowedAt).toLocaleString()}`);
    await broadcast(waiting);
    return;
  }
  const operationId = crypto.randomUUID();
  const startedAt = Date.now();
  await updateRuntimeState((current) => ({
    ...current,
    queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'OPENING', attempts: candidate.attempts + 1, startedAt, operationId, updatedAt: startedAt } : candidate)
  }));
  const tabId = await getOrCreateAutomationTab(session);
  const previousActiveTabId = await getPreviousActiveTabId(tabId);
  try {
    await chrome.tabs.update(tabId, { url: item.targetUrl, active: false });
    await waitForTabLoad(tabId);
    await activateAutomationTab(tabId);
    await wait(300);
    await waitForPublishReady(tabId);
    await assertOperationActive(item.id, operationId);
    await updateRuntimeState((current) => ({ ...current, queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'READY', updatedAt: Date.now() } : candidate) }));
    const lockedState = await getState();
    const lockedItem = lockedState.queue.find((candidate) => candidate.id === item.id);
    if (!lockedItem || lockedItem.operationId !== operationId || lockedItem.status !== 'READY') throw new Error('ITEM_LOCK_LOST');
    await assertOperationActive(item.id, operationId);
    await updateRuntimeState((current) => ({ ...current, queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'PUBLISHING', updatedAt: Date.now() } : candidate) }));
    const result = await chrome.tabs.sendMessage(tabId, { type: 'X_PUBLISH' });
    await wait(1800);
    const after = await inspectTab(tabId);
    if (!result?.ok) throw new Error(result?.reason ?? 'PUBLISH_FAILED');
    const finalStatus = after.composerFound && after.contentPresent ? 'PUBLISHED_UNVERIFIED' : 'PUBLISHED';
    const finishedAt = Date.now();
    const nextItem = getNextPendingItem((await getState()).queue, item.id);
    const nextRunAt = nextItem ? getNextAllowedPublishingTime(finishedAt + profile.intervalMinutes * 60_000, profile.timezone, profile.publishingWindows) : undefined;
    const nextStatus = nextItem ? 'WAITING' : 'COMPLETED';
    const nextState = await updateRuntimeState((current) => ({
      ...current,
      queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: finalStatus, publishedAt: finishedAt, updatedAt: finishedAt, operationId: undefined } : candidate),
      session: current.session ? { ...current.session, status: nextStatus, currentItemId: nextItem?.id, currentIndex: nextItem?.position ?? current.session.currentIndex, nextRunAt, completedAt: nextStatus === 'COMPLETED' ? finishedAt : current.session.completedAt, updatedAt: finishedAt } : null,
      history: [...current.history, { id: crypto.randomUUID(), queueItemId: item.id, link: item.targetUrl, timestamp: finishedAt, attemptNumber: item.attempts + 1, action: 'PUBLISH', result: finalStatus }]
    }));
    await syncHistoricalSession(nextState, nextStatus === 'COMPLETED' ? 'COMPLETED' : 'WAITING');
    await chrome.alarms.clear(ALARM_NAME);
    if (nextRunAt) await chrome.alarms.create(ALARM_NAME, { when: nextRunAt, persistAcrossSessions: true });
    await restoreActiveTab(previousActiveTabId);
    const visibleState = nextStatus === 'COMPLETED' && nextState.session
      ? await closeAutomationTabIfConfigured(nextState.session)
      : nextState;
    if (nextStatus === 'COMPLETED' && nextState.workspaceId) await releaseAutomationOwner(nextState.workspaceId);
    if (nextStatus === 'COMPLETED') await notifyEvent('X-Pilot: اكتملت الجلسة', 'اكتملت جميع عناصر Queue.');
    await broadcast(visibleState);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message.includes('LOGIN') || message.includes('PUBLISH_CONTROLS_NOT_READY')) await notifyEvent('X-Pilot: مطلوب تدخل', message.includes('LOGIN') ? 'تسجيل الدخول إلى X مطلوب.' : 'تعذر العثور على عناصر النشر.');
    if (message.includes('CHALLENGE') || message.includes('CAPTCHA')) await notifyEvent('X-Pilot: تحدٍ أمني', 'تم اكتشاف CAPTCHA أو Challenge وتوقفت الجلسة.');
    if (message === 'AUTOMATION_INTERRUPTED') {
      const interruptedState = await updateRuntimeState((current) => ({
        ...current,
        queue: current.queue.map((candidate) => candidate.id === item.id && candidate.operationId === operationId && candidate.status !== 'PUBLISHING' ? { ...candidate, status: 'PENDING', operationId: undefined, updatedAt: Date.now() } : candidate)
      }));
      await restoreActiveTab(previousActiveTabId);
      await broadcast(interruptedState);
      return;
    }
    const current = await getState();
    const latestItem = current.queue.find((candidate) => candidate.id === item.id);
    if (current.session?.status !== 'RUNNING' || latestItem?.operationId !== operationId) {
      await restoreActiveTab(previousActiveTabId);
      return;
    }
    const exhausted = !latestItem || latestItem.attempts >= session.maxRetries + 1;
    const failedStatus = exhausted ? 'FAILED' : 'PENDING';
    const nextItem = exhausted && session.failureBehavior === 'CONTINUE' ? getNextPendingItem(current.queue, item.id) : undefined;
    const nextRunAt = !exhausted || nextItem ? Date.now() + session.intervalMinutes * 60_000 : undefined;
    const nextStatus = exhausted && session.failureBehavior === 'PAUSE' ? 'PAUSED' : nextItem || !exhausted ? 'WAITING' : 'COMPLETED';
    const nextItemId = nextItem?.id ?? (!exhausted ? item.id : undefined);
    const nextItemIndex = nextItem?.position ?? (!exhausted ? item.position : current.session?.currentIndex);
    const failedState = await updateRuntimeState((currentState) => ({
      ...currentState,
      queue: currentState.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: failedStatus, lastError: message, operationId: undefined, updatedAt: Date.now() } : candidate),
      session: currentState.session ? { ...currentState.session, status: nextStatus, currentItemId: nextItemId, currentIndex: nextItemIndex ?? currentState.session.currentIndex, nextRunAt, completedAt: nextStatus === 'COMPLETED' ? Date.now() : currentState.session.completedAt, updatedAt: Date.now() } : null,
      history: [...currentState.history, { id: crypto.randomUUID(), queueItemId: item.id, link: item.targetUrl, timestamp: Date.now(), attemptNumber: item.attempts + 1, action: 'PUBLISH', result: failedStatus, error: message }]
    }));
    await syncHistoricalSession(failedState, nextStatus === 'COMPLETED' ? 'COMPLETED' : nextStatus === 'PAUSED' ? 'PAUSED' : 'WAITING', message);
    await chrome.alarms.clear(ALARM_NAME);
    if (nextRunAt) await chrome.alarms.create(ALARM_NAME, { when: nextRunAt, persistAcrossSessions: true });
    await restoreActiveTab(previousActiveTabId);
    const visibleState = nextStatus === 'COMPLETED' && failedState.session
      ? await closeAutomationTabIfConfigured(failedState.session)
      : failedState;
    if (nextStatus === 'COMPLETED' && failedState.workspaceId) await releaseAutomationOwner(failedState.workspaceId);
    if (failedStatus === 'FAILED') await notifyEvent('X-Pilot: فشل عنصر', `فشل Item #${item.position}: ${message}`);
    await broadcast(visibleState);
  }
}

async function advanceSession(): Promise<void> {
  const state = await getState();
  if (!state.session || state.session.status !== 'WAITING') return;
  const next = getNextRunnableItem(state.queue, state.session.currentItemId);
    if (!next) {
      const completed = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'COMPLETED', completedAt: Date.now(), nextRunAt: undefined, updatedAt: Date.now() } : null }));
    await syncHistoricalSession(completed, 'COMPLETED');
    const visibleState = completed.session ? await closeAutomationTabIfConfigured(completed.session) : completed;
    if (completed.workspaceId) await releaseAutomationOwner(completed.workspaceId);
    await broadcast(visibleState);
    return;
  }
  const running = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'RUNNING', currentItemId: next.id, currentIndex: next.position, nextRunAt: undefined, updatedAt: Date.now() } : null }));
  await broadcast(running);
  await processCurrentItem();
}

async function extractBank(bankUrl: string, workspaceId: string, mode: 'REPLACE' | 'APPEND' = 'REPLACE', bankId?: string): Promise<AppState> {
  let bankTabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: bankUrl, active: false });
    bankTabId = tab.id;
    if (!bankTabId) throw new Error('BANK_TAB_CREATE_FAILED');
    await waitForTabLoad(bankTabId);
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: bankTabId }, func: () => ({
      anchors: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => ({ raw: a.href, label: a.textContent?.trim() || undefined })),
      markup: document.documentElement.outerHTML
    }) });
    const extraction = extractLinksFromValues([
      ...((result as { anchors?: Array<{ raw: string; label?: string }> } | undefined)?.anchors ?? []),
      { raw: (result as { markup?: string } | undefined)?.markup ?? '' }
    ]);
    const extractedQueue: QueueItem[] = [];
    for (const extracted of extraction.links) {
      extractedQueue.push({ id: crypto.randomUUID(), workspaceId, sourceBankId: bankId, sourceBankUrl: bankUrl, targetUrl: extracted.url, label: extracted.label, position: extractedQueue.length + 1, status: 'PENDING', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() });
    }
    const next = await updateWorkspaceState(workspaceId, (state) => {
      if (mode === 'REPLACE' && state.session && ['RUNNING', 'WAITING', 'PAUSED'].includes(state.session.status)) throw new Error('QUEUE_REPLACE_WHILE_ACTIVE');
      if (mode === 'REPLACE' && state.queue.some((item) => ['PUBLISHED', 'PUBLISHED_UNVERIFIED'].includes(item.status))) throw new Error('QUEUE_REPLACE_HAS_EXECUTED_ITEMS');
      const existingUrls = new Set(state.queue.map((item) => item.targetUrl));
      const queue = mode === 'APPEND'
        ? [...state.queue, ...extractedQueue.filter((item) => !existingUrls.has(item.targetUrl))].map((item, index) => ({ ...item, position: index + 1 }))
        : extractedQueue;
      const now = Date.now();
      const oldBank = state.banks.find((candidate) => candidate.id === bankId) ?? state.banks.find((candidate) => candidate.url === bankUrl);
      const bank = { id: oldBank?.id ?? bankId ?? crypto.randomUUID(), workspaceId, name: oldBank?.name ?? new URL(bankUrl).hostname, description: oldBank?.description, url: bankUrl, favorite: oldBank?.favorite ?? false, archived: oldBank?.archived ?? false, createdAt: oldBank?.createdAt ?? now, updatedAt: now, lastExtractedAt: now, lastExtractedCount: extractedQueue.length };
      const banks = [...state.banks.filter((candidate) => candidate.id !== bank.id && candidate.url !== bankUrl), bank];
      const session = mode === 'APPEND' && state.session
        ? { ...state.session, total: queue.length, updatedAt: now }
        : { ...(state.session ?? {}), workspaceId, bankId: bank.id, id: crypto.randomUUID(), bankUrl, status: 'IDLE' as const, currentIndex: 0, total: queue.length, intervalMinutes: defaultSettings.intervalMinutes, maxRetries: defaultSettings.maxRetries, failureBehavior: defaultSettings.failureBehavior, confirmBeforeStart: defaultSettings.confirmBeforeStart, keepAutomationTabOpen: defaultSettings.keepAutomationTabOpen, closeTabOnComplete: defaultSettings.closeTabOnComplete, version: 1, updatedAt: now };
      return { ...state, queue, banks, session };
    });
    const nextState: AppState = { workspaceId: next.workspaceId, queue: next.queue, session: next.session, history: next.history };
    await broadcast(nextState);
    console.info('Extracted bank', { total: next.queue.length, duplicateCount: extraction.duplicateCount, invalidCount: extraction.invalidCount, mode });
    return nextState;
  } finally {
    if (bankTabId) await chrome.tabs.remove(bankTabId).catch(() => undefined);
  }
}

async function refreshBank(workspaceId: string, bankId: string): Promise<BankDiffResult> {
  const state = await getWorkspaceState(workspaceId);
  const bank = state.banks.find((candidate) => candidate.id === bankId);
  if (!bank || bank.archived) throw new Error('BANK_NOT_FOUND_OR_ARCHIVED');
  let bankTabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: bank.url, active: false });
    bankTabId = tab.id;
    if (!bankTabId) throw new Error('BANK_TAB_CREATE_FAILED');
    await waitForTabLoad(bankTabId);
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: bankTabId }, func: () => ({
      anchors: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => ({ raw: a.href, label: a.textContent?.trim() || undefined })),
      markup: document.documentElement.outerHTML,
    }) });
    const extraction = extractLinksFromValues([
      ...((result as { anchors?: Array<{ raw: string; label?: string }> } | undefined)?.anchors ?? []),
      { raw: (result as { markup?: string } | undefined)?.markup ?? '' },
    ]);
    const snapshot: BankSnapshotItem[] = [];
    for (const item of [...extraction.links, ...extraction.invalidLinks]) {
      const fingerprint = await fingerprintTweet(item.url, item.label);
      snapshot.push({ url: item.url, label: item.label, contentFingerprint: fingerprint?.fingerprint, normalizedContent: fingerprint?.content });
    }
    const fingerprintIndex = new Map<string, { item: QueueItem; workspaceId: string }>();
    for (const workspace of await listWorkspaces(true)) {
      const candidateState = await getWorkspaceState(workspace.id);
      for (const item of candidateState.queue) {
        const fingerprint = item.contentFingerprint ? { fingerprint: item.contentFingerprint } : await fingerprintTweet(item.targetUrl, item.label);
        if (fingerprint) fingerprintIndex.set(fingerprint.fingerprint, { item, workspaceId: workspace.id });
      }
    }
    const settings = await getSettings();
    const diff = classifyBankDiff(workspaceId, bank, snapshot, state.queue, Date.now(), fingerprintIndex, settings.duplicatePolicy);
    bankDiffs.set(`${workspaceId}:${bankId}`, diff);
    await updateWorkspaceState(workspaceId, (current) => ({ ...current, banks: current.banks.map((item) => item.id === bankId ? { ...item, lastSnapshot: snapshot, lastSnapshotAt: diff.refreshedAt, lastExtractedAt: diff.refreshedAt, lastExtractedCount: snapshot.length, updatedAt: diff.refreshedAt } : item) }));
    return diff;
  } finally {
    if (bankTabId) await chrome.tabs.remove(bankTabId).catch(() => undefined);
  }
}

async function performPreflight(workspaceId: string) {
  const state = await getWorkspaceState(workspaceId);
  const meta = await getMeta();
  const workspace = (await listWorkspaces(true)).find((item) => item.id === workspaceId);
  const settings = await getSettings();
  const permissionsGranted = await chrome.permissions.contains({ origins: ['https://x.com/*', 'https://twitter.com/*'] }).catch(() => false);
  let xInspection: ContentInspection | null = null;
  const candidateTabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const xTab = candidateTabs.find((tab) => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(tab.url ?? ''));
  if (xTab?.id) xInspection = await inspectTab(xTab.id).catch(() => null);
  return runPreflight({ workspace, queue: state.queue, banks: state.banks, automationWorkspaceId: meta.automationWorkspaceId, alarmsAvailable: Boolean(chrome.alarms), permissionsGranted, settings, xInspection });
}

async function scheduleSession(workspaceId: string, startAt: number): Promise<AppState> {
  if (!Number.isFinite(startAt) || startAt <= Date.now()) throw new Error('SCHEDULE_START_MUST_BE_IN_FUTURE');
  const preflight = await performPreflight(workspaceId);
  if (!preflight.ready) { await notifyEvent('X-Pilot: فشل فحص الجاهزية', preflight.summary); throw new Error(`PREFLIGHT_FAILED:${preflight.summary}`); }
  await claimAutomationOwner(workspaceId);
  const settings = await getWorkspaceSettings(workspaceId);
  const scheduled = await updateWorkspaceState(workspaceId, (current) => ({
    ...current,
    session: {
      ...(current.session ?? {
        id: crypto.randomUUID(), workspaceId, bankId: current.banks.find((bank) => !bank.archived)?.id, bankUrl: current.banks.find((bank) => !bank.archived)?.url ?? '', status: 'SCHEDULED' as const, currentIndex: current.queue.find((item) => item.status === 'PENDING')?.position ?? 0, total: current.queue.length, version: 1,
      }),
      ...settings,
      workspaceId,
      status: 'SCHEDULED',
      scheduledStartAt: startAt,
      nextRunAt: startAt,
      currentItemId: current.session?.currentItemId ?? current.queue.find((item) => item.status === 'PENDING')?.id,
      updatedAt: Date.now(),
    },
  }));
  await chrome.alarms.clear(SCHEDULE_ALARM_NAME);
  await chrome.alarms.create(SCHEDULE_ALARM_NAME, { when: startAt, persistAcrossSessions: true });
  const state: AppState = { workspaceId: scheduled.workspaceId, queue: scheduled.queue, session: scheduled.session, history: scheduled.history };
  await notifyEvent('X-Pilot: جلسة مجدولة', `ستبدأ الجلسة في ${new Date(startAt).toLocaleString()}`);
  await broadcast(state);
  return state;
}

async function handleScheduledStart(): Promise<void> {
  const state = await getState();
  if (!state.session || state.session.status !== 'SCHEDULED') return;
  if ((state.session.scheduledStartAt ?? 0) > Date.now()) {
    await chrome.alarms.create(SCHEDULE_ALARM_NAME, { when: state.session.scheduledStartAt!, persistAcrossSessions: true });
    return;
  }
  const item = state.session.currentItemId ? state.queue.find((candidate) => candidate.id === state.session!.currentItemId) : undefined;
  if (!item || !canStartItem(item.status)) {
    await chrome.alarms.clear(SCHEDULE_ALARM_NAME);
    const failed = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'FAILED', scheduledStartAt: undefined, nextRunAt: undefined, updatedAt: Date.now() } : null }));
    await notifyEvent('X-Pilot: فشل بدء الجدولة', 'لا يوجد عنصر Queue قابل للتشغيل عند موعد الجدولة.');
    await broadcast(failed);
    return;
  }
  const running = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'RUNNING', startedAt: Date.now(), scheduledStartAt: undefined, nextRunAt: undefined, updatedAt: Date.now() } : null }));
  await chrome.alarms.clear(SCHEDULE_ALARM_NAME);
  await notifyEvent('X-Pilot: بدأت الجلسة', 'بدأت جلسة النشر المجدولة.');
  let ready = running;
  if (running.workspaceId && running.session && !running.session.historicalSessionId) {
    const historical = createHistoricalSession(running.session, running.queue);
    await saveHistoricalSession(running.workspaceId, historical);
    ready = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, historicalSessionId: historical.id, updatedAt: Date.now() } : null }));
  }
  await broadcast(ready);
  await processCurrentItem();
}

async function handleMessage(message: RuntimeMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATE': return getActiveState();
    case 'GET_WORKSPACES': return { workspaces: await listWorkspaces(true), meta: await getMeta() };
    case 'GET_WORKSPACE_STATE': return getWorkspaceState(message.workspaceId ?? (await getMeta()).activeWorkspaceId);
    case 'GET_BANKS': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      return { workspaceId, banks: await listBanks(workspaceId, true) };
    }
    case 'GET_BANK_DIFF': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      return bankDiffs.get(`${workspaceId}:${message.bankId}`) ?? null;
    }
    case 'CREATE_BANK': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      return createBank(workspaceId, message.name, message.url, message.description);
    }
    case 'UPDATE_BANK': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      return updateBank(workspaceId, message.bankId, message.patch);
    }
    case 'ARCHIVE_BANK': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      await archiveBank(workspaceId, message.bankId); return getWorkspaceState(workspaceId);
    }
    case 'RESTORE_BANK': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      await restoreBank(workspaceId, message.bankId); return getWorkspaceState(workspaceId);
    }
    case 'DELETE_BANK': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      await deleteBank(workspaceId, message.bankId, message.confirmed); return getWorkspaceState(workspaceId);
    }
    case 'GET_SESSION_HISTORY': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      return { workspaceId, sessions: await getHistoricalSessions(workspaceId) };
    }
    case 'PREFLIGHT_CHECK': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      return performPreflight(workspaceId);
    }
    case 'GET_DRY_RUN': {
      const stored = await chrome.storage.local.get(DRY_RUN_KEY);
      return stored[DRY_RUN_KEY] ?? null;
    }
    case 'EXPORT_BACKUP':
      return exportBackup();
    case 'VALIDATE_BACKUP':
      return validateBackup(message.backup);
    case 'RESTORE_BACKUP': {
      const current = await getState();
      if (current.session && ['RUNNING', 'WAITING', 'PAUSED'].includes(current.session.status)) throw new Error('BACKUP_RESTORE_WHILE_AUTOMATION_ACTIVE');
      const summary = await restoreBackup(message.backup, message.confirmed);
      const restored = await getState();
      await broadcast(restored);
      return { ...restored, backupSummary: summary };
    }
    case 'DRY_RUN_STOP':
      dryRunStopRequested = true;
      return chrome.storage.local.get(DRY_RUN_KEY).then((stored) => stored[DRY_RUN_KEY] ?? null);
    case 'DRY_RUN_FIRST':
      return runDryRun('FIRST_ITEM', message.workspaceId ?? (await getMeta()).activeWorkspaceId);
    case 'DRY_RUN_QUEUE':
      return runDryRun('ENTIRE_QUEUE', message.workspaceId ?? (await getMeta()).activeWorkspaceId);
    case 'CREATE_WORKSPACE': return createWorkspace(message.name, message.description, message.color, message.icon);
    case 'UPDATE_WORKSPACE_PROFILE': return updateWorkspaceProfile(message.workspaceId, message.profile);
    case 'CLEAR_WORKSPACE_PROFILE': return clearWorkspaceProfile(message.workspaceId);
    case 'UPDATE_WORKSPACE': return updateWorkspace(message.workspaceId, message.patch);
    case 'ARCHIVE_WORKSPACE': return archiveWorkspace(message.workspaceId);
    case 'RESTORE_WORKSPACE': return restoreWorkspace(message.workspaceId);
    case 'DELETE_WORKSPACE': return deleteWorkspace(message.workspaceId, message.confirmed);
    case 'SET_ACTIVE_WORKSPACE': return setActiveWorkspace(message.workspaceId);
    case 'GET_RUNTIME_STATUS': return getRuntimeStatus();
    case 'EXTRACT_BANK': {
      const meta = await getMeta();
      const workspaceId = message.workspaceId ?? meta.activeWorkspaceId;
      if (meta.automationWorkspaceId && meta.automationWorkspaceId !== workspaceId) throw new Error('AUTOMATION_OWNED_BY_OTHER_WORKSPACE');
      const bank = message.bankId ? (await getWorkspaceState(workspaceId)).banks.find((candidate) => candidate.id === message.bankId) : undefined;
      if (message.bankId && (!bank || bank.archived)) throw new Error('BANK_NOT_FOUND_OR_ARCHIVED');
      return extractBank(bank?.url ?? message.bankUrl, workspaceId, message.mode ?? 'REPLACE', message.bankId);
    }
    case 'REFRESH_BANK': {
      const meta = await getMeta();
      const workspaceId = message.workspaceId ?? meta.activeWorkspaceId;
      if (meta.automationWorkspaceId && meta.automationWorkspaceId !== workspaceId) throw new Error('AUTOMATION_OWNED_BY_OTHER_WORKSPACE');
      return refreshBank(workspaceId, message.bankId);
    }
    case 'ADD_DIFF_ITEMS': {
      const meta = await getMeta();
      const workspaceId = message.workspaceId ?? meta.activeWorkspaceId;
      const diff = bankDiffs.get(`${workspaceId}:${message.bankId}`);
      if (!diff) throw new Error('BANK_DIFF_NOT_FOUND');
      const workspaceState = await getWorkspaceState(workspaceId);
      const bank = workspaceState.banks.find((candidate) => candidate.id === message.bankId);
      if (!bank) throw new Error('BANK_NOT_FOUND');
      const queue = mergeSelectedDiffItems(workspaceState.queue, diff, bank, message.itemIds, Date.now(), (await getSettings()).duplicatePolicy);
      const saved = await updateWorkspaceState(workspaceId, (current) => ({ ...current, queue, session: current.session ? { ...current.session, total: queue.length, updatedAt: Date.now() } : current.session }));
      bankDiffs.delete(`${workspaceId}:${message.bankId}`);
      const nextState: AppState = { workspaceId: saved.workspaceId, queue: saved.queue, session: saved.session, history: saved.history };
      await broadcast(nextState);
      return nextState;
    }
    case 'DISCARD_BANK_DIFF': {
      const workspaceId = message.workspaceId ?? (await getMeta()).activeWorkspaceId;
      bankDiffs.delete(`${workspaceId}:${message.bankId}`);
      return { discarded: true };
    }
    case 'UPDATE_SETTINGS': await saveSettings(message.settings); return updateRuntimeState((state) => ({ ...state, session: state.session ? { ...state.session, ...message.settings, updatedAt: Date.now() } : state.session }));
    case 'SCHEDULE': return scheduleSession(message.workspaceId ?? (await getMeta()).activeWorkspaceId, message.startAt);
    case 'RESCHEDULE': return scheduleSession(message.workspaceId ?? (await getMeta()).activeWorkspaceId, message.startAt);
    case 'CANCEL_SCHEDULE': {
      await chrome.alarms.clear(SCHEDULE_ALARM_NAME);
      const cancelled = await updateRuntimeState((current) => ({ ...current, session: current.session?.status === 'SCHEDULED' ? { ...current.session, status: 'STOPPED', scheduledStartAt: undefined, nextRunAt: undefined, updatedAt: Date.now() } : current.session }));
      await releaseAutomationOwner(cancelled.workspaceId ?? (await getMeta()).activeWorkspaceId);
      await notifyEvent('X-Pilot: أُلغيت الجدولة', 'تم إلغاء جلسة النشر المجدولة.');
      await broadcast(cancelled);
      return cancelled;
    }
    case 'START': {
      const meta = await getMeta();
      const preflight = await performPreflight(message.workspaceId ?? meta.activeWorkspaceId);
      if (!preflight.ready) { await notifyEvent('X-Pilot: فشل فحص الجاهزية', preflight.summary); throw new Error(`PREFLIGHT_FAILED:${preflight.summary}`); }
      await claimAutomationOwner(message.workspaceId ?? meta.activeWorkspaceId);
      const settings = await getWorkspaceSettings(message.workspaceId ?? meta.activeWorkspaceId);
      const state = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, ...settings, status: 'RUNNING', startedAt: current.session.startedAt ?? Date.now(), currentItemId: current.session.currentItemId ?? current.queue.find((item) => item.status === 'PENDING')?.id, updatedAt: Date.now() } : null }));
      if (state.workspaceId && state.session && !state.session.historicalSessionId) {
        const historical = createHistoricalSession(state.session, state.queue);
        await saveHistoricalSession(state.workspaceId, historical);
        const linked = await updateRuntimeState((current) => ({ ...current, session: current.session ? { ...current.session, historicalSessionId: historical.id, updatedAt: Date.now() } : null }));
        await broadcast(linked); await processCurrentItem(); return getState();
      }
      await broadcast(state); await processCurrentItem(); return getState();
    }
    case 'PAUSE': {
      await chrome.alarms.clear(ALARM_NAME);
      const paused = await updateRuntimeState((state) => ({
        ...state,
        queue: state.queue.map((item) => item.id === state.session?.currentItemId && (item.status === 'OPENING' || item.status === 'READY') ? { ...item, status: 'PENDING', operationId: undefined, updatedAt: Date.now() } : item),
        session: state.session ? { ...state.session, status: 'PAUSED', pausedAt: Date.now(), nextRunAt: state.session.status === 'WAITING' ? state.session.nextRunAt : undefined, updatedAt: Date.now() } : null
      }));
      await syncHistoricalSession(paused, 'PAUSED');
      await notifyEvent('X-Pilot: توقفت Queue مؤقتًا', 'تم إيقاف Queue مؤقتًا.');
      await broadcast(paused);
      return paused;
    }
    case 'RESUME': {
      const current = await getState();
      if (!current.session || current.session.status !== 'PAUSED') return current;
      const nextRunAt = current.session.nextRunAt;
      const hasFutureAlarm = Boolean(nextRunAt && nextRunAt > Date.now());
      if (hasFutureAlarm && nextRunAt) {
        await chrome.alarms.create(ALARM_NAME, { when: nextRunAt, persistAcrossSessions: true });
        const waiting = await updateRuntimeState((state) => ({ ...state, session: state.session ? { ...state.session, status: 'WAITING', pausedAt: undefined, updatedAt: Date.now() } : null }));
        await broadcast(waiting);
        return waiting;
      }
      const currentItem = current.queue.find((item) => item.id === current.session?.currentItemId && canStartItem(item.status));
      const next = currentItem ?? getNextPendingItem(current.queue);
      const running = await updateRuntimeState((state) => ({ ...state, session: state.session ? { ...state.session, status: 'RUNNING', pausedAt: undefined, nextRunAt: undefined, currentItemId: next?.id, currentIndex: next?.position ?? state.session.currentIndex, updatedAt: Date.now() } : null }));
      await broadcast(running);
      if (next) await processCurrentItem();
      return running;
    }
    case 'STOP': {
      await chrome.alarms.clear(ALARM_NAME);
      await chrome.alarms.clear(SCHEDULE_ALARM_NAME);
      const stopped = await updateRuntimeState((state) => ({
        ...state,
        queue: state.queue.map((item) => item.id === state.session?.currentItemId && (item.status === 'OPENING' || item.status === 'READY') ? { ...item, status: 'PENDING', operationId: undefined, updatedAt: Date.now() } : item),
        session: state.session ? { ...state.session, status: 'STOPPED', scheduledStartAt: undefined, nextRunAt: undefined, updatedAt: Date.now() } : null
      }));
      await syncHistoricalSession(stopped, 'STOPPED');
      const result = stopped.session ? await closeAutomationTabIfConfigured(stopped.session) : stopped;
      if (result.workspaceId) await releaseAutomationOwner(result.workspaceId);
      return result;
    }
    case 'SKIP_CURRENT': return updateRuntimeState((state) => ({ ...state, queue: state.queue.map((item) => item.id === state.session?.currentItemId ? { ...item, status: 'SKIPPED', updatedAt: Date.now() } : item) }));
    case 'RETRY_ITEM': return updateRuntimeState((state) => ({ ...state, queue: state.queue.map((item) => item.id === message.itemId ? { ...item, status: 'PENDING', attempts: 0, lastError: undefined, updatedAt: Date.now() } : item) }));
    case 'DELETE_ITEM': return updateRuntimeState((state) => ({ ...state, queue: state.queue.filter((item) => item.id !== message.itemId).map((item, index) => ({ ...item, position: index + 1 })) }));
    case 'CLEAR_COMPLETED': return updateRuntimeState((state) => ({ ...state, queue: state.queue.filter((item) => !isTerminalItem(item.status)).map((item, index) => ({ ...item, position: index + 1 })) }));
    case 'REORDER': return updateRuntimeState((state) => { const index = state.queue.findIndex((item) => item.id === message.itemId); const target = message.direction === 'up' ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= state.queue.length) return state; const queue = [...state.queue]; [queue[index], queue[target]] = [queue[target], queue[index]]; return { ...state, queue: queue.map((item, position) => ({ ...item, position: position + 1 })) }; });
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => { handleMessage(message).then(sendResponse).catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })); return true; });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void advanceSession(); if (alarm.name === SCHEDULE_ALARM_NAME) void handleScheduledStart(); });
chrome.runtime.onStartup.addListener(() => { void recoverPersistedState(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); void recoverPersistedState(); });
