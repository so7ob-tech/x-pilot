import type { AppState, AutomationSession, BankDiffResult, BankSnapshotItem, ContentInspection, QueueItem, RuntimeMessage, RuntimeStatus, Settings } from '../domain/models';
import { createHistoricalSession, defaultSettings } from '../domain/models';
import { classifyBankDiff, mergeSelectedDiffItems } from '../domain/bank-diff';
import { fingerprintTweet } from '../domain/content-fingerprint';
import { hasFutureRecoveryAlarm, normalizeRecovery } from '../domain/recovery';
import { canStartItem, getNextPendingItem, getNextRunnableItem, isTerminalItem } from '../domain/state-machine';
import { extractLinksFromValues } from '../extraction/bank-parser';
import { addAttempt, archiveBank, claimAutomationOwner, createBank, createWorkspace, deleteBank, deleteWorkspace, getAutomationOwner, getHistoricalSessions, getMeta, getSettings, getState as getActiveState, getWorkspaceState, listBanks, listWorkspaces, releaseAutomationOwner, restoreBank, saveHistoricalSession, saveQueue, saveSession, saveSettings, setActiveWorkspace, updateBank, updateHistoricalSession, updateState as updateActiveState, updateWorkspace, updateWorkspaceState, archiveWorkspace, restoreWorkspace } from '../storage/storage-repository';

const ALARM_NAME = 'x-queue-next-item';
const bankDiffs = new Map<string, BankDiffResult>();
const AUTOMATION_TAB_KEY = 'automationTabId';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const injectedContentTabs = new Set<number>();
const contentInjectionInFlight = new Map<number, Promise<void>>();

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

async function recoverPersistedState(): Promise<AppState> {
  const current = await getState();
  const recovered = normalizeRecovery(current);
  const changed = JSON.stringify(recovered) !== JSON.stringify(current);
  const state = changed ? await updateRuntimeState(() => recovered) : current;
  await chrome.alarms.clear(ALARM_NAME);
  if (hasFutureRecoveryAlarm(state)) {
    await chrome.alarms.create(ALARM_NAME, { when: state.session!.nextRunAt!, persistAcrossSessions: true });
  }
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
    const nextRunAt = nextItem ? finishedAt + session.intervalMinutes * 60_000 : undefined;
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
    await broadcast(visibleState);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
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
    case 'CREATE_WORKSPACE': return createWorkspace(message.name, message.description, message.color, message.icon);
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
    case 'START': {
      const meta = await getMeta();
      await claimAutomationOwner(message.workspaceId ?? meta.activeWorkspaceId);
      const settings = await getSettings();
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
      const stopped = await updateRuntimeState((state) => ({
        ...state,
        queue: state.queue.map((item) => item.id === state.session?.currentItemId && (item.status === 'OPENING' || item.status === 'READY') ? { ...item, status: 'PENDING', operationId: undefined, updatedAt: Date.now() } : item),
        session: state.session ? { ...state.session, status: 'STOPPED', nextRunAt: undefined, updatedAt: Date.now() } : null
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
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void advanceSession(); });
chrome.runtime.onStartup.addListener(() => { void recoverPersistedState(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); void recoverPersistedState(); });
