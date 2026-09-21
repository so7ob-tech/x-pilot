import type { AppState, AutomationSession, ContentInspection, QueueItem, RuntimeMessage, RuntimeStatus, Settings } from '../domain/models';
import { defaultSettings } from '../domain/models';
import { hasFutureRecoveryAlarm, normalizeRecovery } from '../domain/recovery';
import { canStartItem, getNextPendingItem, getNextRunnableItem, isTerminalItem } from '../domain/state-machine';
import { extractLinksFromValues } from '../extraction/bank-parser';
import { addAttempt, getSettings, getState, saveQueue, saveSession, saveSettings, updateState } from '../storage/storage-repository';

const ALARM_NAME = 'x-queue-next-item';
const AUTOMATION_TAB_KEY = 'automationTabId';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const injectedContentTabs = new Set<number>();
const contentInjectionInFlight = new Map<number, Promise<void>>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') injectedContentTabs.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedContentTabs.delete(tabId);
  contentInjectionInFlight.delete(tabId);
  void getState().then((state) => {
    if (state.session?.automationTabId !== tabId) return;
    void chrome.storage.local.remove(AUTOMATION_TAB_KEY);
    void updateState((current) => current.session?.automationTabId === tabId
      ? { ...current, session: { ...current.session, automationTabId: undefined, updatedAt: Date.now() } }
      : current);
  }).catch(() => undefined);
});

async function broadcast(state?: AppState) {
  const snapshot = state ?? await getState();
  await chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: snapshot }).catch(() => undefined);
}

async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const state = await getState();
  const session = state.session;
  const activeEngine = session?.status === 'RUNNING' || session?.status === 'WAITING' || session?.status === 'PAUSED';
  if (!activeEngine || !session?.automationTabId) {
    return { engineStatus: session?.status ?? 'IDLE', connection: 'NOT_REQUIRED', checkedAt: Date.now() };
  }
  try {
    await chrome.tabs.get(session.automationTabId);
    return { engineStatus: session.status, connection: 'CONNECTED', automationTabId: session.automationTabId, checkedAt: Date.now() };
  } catch {
    return { engineStatus: session.status, connection: 'DISCONNECTED', automationTabId: session.automationTabId, checkedAt: Date.now() };
  }
}

async function recoverPersistedState(): Promise<AppState> {
  const current = await getState();
  const recovered = normalizeRecovery(current);
  const changed = JSON.stringify(recovered) !== JSON.stringify(current);
  const state = changed ? await updateState(() => recovered) : current;
  await chrome.alarms.clear(ALARM_NAME);
  if (hasFutureRecoveryAlarm(state)) {
    await chrome.alarms.create(ALARM_NAME, { when: state.session!.nextRunAt!, persistAcrossSessions: true });
  }
  await broadcast(state);
  return state;
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
  await updateState((state) => ({ ...state, session: state.session ? { ...state.session, automationTabId: tab.id, updatedAt: Date.now() } : null }));
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
  return updateState((state) => state.session?.automationTabId === tabId
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
  await updateState((current) => ({
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
    await updateState((current) => ({ ...current, queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'READY', updatedAt: Date.now() } : candidate) }));
    const lockedState = await getState();
    const lockedItem = lockedState.queue.find((candidate) => candidate.id === item.id);
    if (!lockedItem || lockedItem.operationId !== operationId || lockedItem.status !== 'READY') throw new Error('ITEM_LOCK_LOST');
    await assertOperationActive(item.id, operationId);
    await updateState((current) => ({ ...current, queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'PUBLISHING', updatedAt: Date.now() } : candidate) }));
    const result = await chrome.tabs.sendMessage(tabId, { type: 'X_PUBLISH' });
    await wait(1800);
    const after = await inspectTab(tabId);
    if (!result?.ok) throw new Error(result?.reason ?? 'PUBLISH_FAILED');
    const finalStatus = after.composerFound && after.contentPresent ? 'PUBLISHED_UNVERIFIED' : 'PUBLISHED';
    const finishedAt = Date.now();
    const nextItem = getNextPendingItem((await getState()).queue, item.id);
    const nextRunAt = nextItem ? finishedAt + session.intervalMinutes * 60_000 : undefined;
    const nextStatus = nextItem ? 'WAITING' : 'COMPLETED';
    const nextState = await updateState((current) => ({
      ...current,
      queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: finalStatus, publishedAt: finishedAt, updatedAt: finishedAt, operationId: undefined } : candidate),
      session: current.session ? { ...current.session, status: nextStatus, currentItemId: nextItem?.id, currentIndex: nextItem?.position ?? current.session.currentIndex, nextRunAt, completedAt: nextStatus === 'COMPLETED' ? finishedAt : current.session.completedAt, updatedAt: finishedAt } : null,
      history: [...current.history, { id: crypto.randomUUID(), queueItemId: item.id, link: item.targetUrl, timestamp: finishedAt, attemptNumber: item.attempts + 1, action: 'PUBLISH', result: finalStatus }]
    }));
    await chrome.alarms.clear(ALARM_NAME);
    if (nextRunAt) await chrome.alarms.create(ALARM_NAME, { when: nextRunAt, persistAcrossSessions: true });
    await restoreActiveTab(previousActiveTabId);
    const visibleState = nextStatus === 'COMPLETED' && nextState.session
      ? await closeAutomationTabIfConfigured(nextState.session)
      : nextState;
    await broadcast(visibleState);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'AUTOMATION_INTERRUPTED') {
      const interruptedState = await updateState((current) => ({
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
    const failedState = await updateState((currentState) => ({
      ...currentState,
      queue: currentState.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: failedStatus, lastError: message, operationId: undefined, updatedAt: Date.now() } : candidate),
      session: currentState.session ? { ...currentState.session, status: nextStatus, currentItemId: nextItemId, currentIndex: nextItemIndex ?? currentState.session.currentIndex, nextRunAt, completedAt: nextStatus === 'COMPLETED' ? Date.now() : currentState.session.completedAt, updatedAt: Date.now() } : null,
      history: [...currentState.history, { id: crypto.randomUUID(), queueItemId: item.id, link: item.targetUrl, timestamp: Date.now(), attemptNumber: item.attempts + 1, action: 'PUBLISH', result: failedStatus, error: message }]
    }));
    await chrome.alarms.clear(ALARM_NAME);
    if (nextRunAt) await chrome.alarms.create(ALARM_NAME, { when: nextRunAt, persistAcrossSessions: true });
    await restoreActiveTab(previousActiveTabId);
    const visibleState = nextStatus === 'COMPLETED' && failedState.session
      ? await closeAutomationTabIfConfigured(failedState.session)
      : failedState;
    await broadcast(visibleState);
  }
}

async function advanceSession(): Promise<void> {
  const state = await getState();
  if (!state.session || state.session.status !== 'WAITING') return;
  const next = getNextRunnableItem(state.queue, state.session.currentItemId);
  if (!next) {
    const completed = await updateState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'COMPLETED', completedAt: Date.now(), nextRunAt: undefined, updatedAt: Date.now() } : null }));
    const visibleState = completed.session ? await closeAutomationTabIfConfigured(completed.session) : completed;
    await broadcast(visibleState);
    return;
  }
  const running = await updateState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'RUNNING', currentItemId: next.id, currentIndex: next.position, nextRunAt: undefined, updatedAt: Date.now() } : null }));
  await broadcast(running);
  await processCurrentItem();
}

async function extractBank(bankUrl: string): Promise<AppState> {
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
    const queue: QueueItem[] = [];
    for (const extracted of extraction.links) {
      queue.push({ id: crypto.randomUUID(), sourceBankUrl: bankUrl, targetUrl: extracted.url, label: extracted.label, position: queue.length + 1, status: 'PENDING', attempts: 0, createdAt: Date.now(), updatedAt: Date.now() });
    }
    const nextState = await updateState((state) => ({ ...state, queue, session: { ...state.session, id: crypto.randomUUID(), bankUrl, status: 'IDLE', currentIndex: 0, total: queue.length, intervalMinutes: defaultSettings.intervalMinutes, maxRetries: defaultSettings.maxRetries, failureBehavior: defaultSettings.failureBehavior, confirmBeforeStart: defaultSettings.confirmBeforeStart, keepAutomationTabOpen: defaultSettings.keepAutomationTabOpen, closeTabOnComplete: defaultSettings.closeTabOnComplete, version: 1, updatedAt: Date.now() } }));
    await broadcast(nextState);
    console.info('Extracted bank', { total: queue.length, duplicateCount: extraction.duplicateCount, invalidCount: extraction.invalidCount });
    return nextState;
  } finally {
    if (bankTabId) await chrome.tabs.remove(bankTabId).catch(() => undefined);
  }
}

async function handleMessage(message: RuntimeMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATE': return getState();
    case 'GET_RUNTIME_STATUS': return getRuntimeStatus();
    case 'EXTRACT_BANK': return extractBank(message.bankUrl);
    case 'UPDATE_SETTINGS': await saveSettings(message.settings); return updateState((state) => ({ ...state, session: state.session ? { ...state.session, ...message.settings, updatedAt: Date.now() } : state.session }));
    case 'START': {
      const settings = await getSettings();
      const state = await updateState((current) => ({ ...current, session: current.session ? { ...current.session, ...settings, status: 'RUNNING', startedAt: current.session.startedAt ?? Date.now(), currentItemId: current.session.currentItemId ?? current.queue.find((item) => item.status === 'PENDING')?.id, updatedAt: Date.now() } : null }));
      await broadcast(state); await processCurrentItem(); return getState();
    }
    case 'PAUSE': {
      await chrome.alarms.clear(ALARM_NAME);
      const paused = await updateState((state) => ({
        ...state,
        queue: state.queue.map((item) => item.id === state.session?.currentItemId && (item.status === 'OPENING' || item.status === 'READY') ? { ...item, status: 'PENDING', operationId: undefined, updatedAt: Date.now() } : item),
        session: state.session ? { ...state.session, status: 'PAUSED', pausedAt: Date.now(), nextRunAt: state.session.status === 'WAITING' ? state.session.nextRunAt : undefined, updatedAt: Date.now() } : null
      }));
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
        const waiting = await updateState((state) => ({ ...state, session: state.session ? { ...state.session, status: 'WAITING', pausedAt: undefined, updatedAt: Date.now() } : null }));
        await broadcast(waiting);
        return waiting;
      }
      const currentItem = current.queue.find((item) => item.id === current.session?.currentItemId && canStartItem(item.status));
      const next = currentItem ?? getNextPendingItem(current.queue);
      const running = await updateState((state) => ({ ...state, session: state.session ? { ...state.session, status: 'RUNNING', pausedAt: undefined, nextRunAt: undefined, currentItemId: next?.id, currentIndex: next?.position ?? state.session.currentIndex, updatedAt: Date.now() } : null }));
      await broadcast(running);
      if (next) await processCurrentItem();
      return running;
    }
    case 'STOP': {
      await chrome.alarms.clear(ALARM_NAME);
      const stopped = await updateState((state) => ({
        ...state,
        queue: state.queue.map((item) => item.id === state.session?.currentItemId && (item.status === 'OPENING' || item.status === 'READY') ? { ...item, status: 'PENDING', operationId: undefined, updatedAt: Date.now() } : item),
        session: state.session ? { ...state.session, status: 'STOPPED', nextRunAt: undefined, updatedAt: Date.now() } : null
      }));
      return stopped.session ? closeAutomationTabIfConfigured(stopped.session) : stopped;
    }
    case 'SKIP_CURRENT': return updateState((state) => ({ ...state, queue: state.queue.map((item) => item.id === state.session?.currentItemId ? { ...item, status: 'SKIPPED', updatedAt: Date.now() } : item) }));
    case 'RETRY_ITEM': return updateState((state) => ({ ...state, queue: state.queue.map((item) => item.id === message.itemId ? { ...item, status: 'PENDING', attempts: 0, lastError: undefined, updatedAt: Date.now() } : item) }));
    case 'DELETE_ITEM': return updateState((state) => ({ ...state, queue: state.queue.filter((item) => item.id !== message.itemId).map((item, index) => ({ ...item, position: index + 1 })) }));
    case 'CLEAR_COMPLETED': return updateState((state) => ({ ...state, queue: state.queue.filter((item) => !isTerminalItem(item.status)).map((item, index) => ({ ...item, position: index + 1 })) }));
    case 'REORDER': return updateState((state) => { const index = state.queue.findIndex((item) => item.id === message.itemId); const target = message.direction === 'up' ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= state.queue.length) return state; const queue = [...state.queue]; [queue[index], queue[target]] = [queue[target], queue[index]]; return { ...state, queue: queue.map((item, position) => ({ ...item, position: position + 1 })) }; });
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => { handleMessage(message).then(sendResponse).catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })); return true; });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void advanceSession(); });
chrome.runtime.onStartup.addListener(() => { void recoverPersistedState(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); void recoverPersistedState(); });
