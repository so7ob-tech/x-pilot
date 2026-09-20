import type { AppState, AutomationSession, ContentInspection, QueueItem, RuntimeMessage, Settings } from '../domain/models';
import { defaultSettings } from '../domain/models';
import { canStartItem, getNextPendingItem, isTerminalItem } from '../domain/state-machine';
import { extractLinksFromValues } from '../extraction/bank-parser';
import { addAttempt, getSettings, getState, saveQueue, saveSession, saveSettings, updateState } from '../storage/storage-repository';

const ALARM_NAME = 'x-queue-next-item';
const AUTOMATION_TAB_KEY = 'automationTabId';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function broadcast(state?: AppState) {
  const snapshot = state ?? await getState();
  await chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: snapshot }).catch(() => undefined);
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
    const cleanup = () => { chrome.tabs.onUpdated.removeListener(listener); if (timer) clearTimeout(timer); };
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') { cleanup(); resolve(); }
    };
    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(() => { cleanup(); reject(new Error('TAB_LOAD_TIMEOUT')); }, timeoutMs) as unknown as number;
  });
}

async function inspectTab(tabId: number): Promise<ContentInspection> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'X_INSPECT' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
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
  try {
    await chrome.tabs.update(tabId, { url: item.targetUrl, active: false });
    await waitForTabLoad(tabId);
    await waitForPublishReady(tabId);
    await updateState((current) => ({ ...current, queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'READY', updatedAt: Date.now() } : candidate) }));
    const lockedState = await getState();
    const lockedItem = lockedState.queue.find((candidate) => candidate.id === item.id);
    if (!lockedItem || lockedItem.operationId !== operationId || lockedItem.status !== 'READY') throw new Error('ITEM_LOCK_LOST');
    await updateState((current) => ({ ...current, queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: 'PUBLISHING', updatedAt: Date.now() } : candidate) }));
    const result = await chrome.tabs.sendMessage(tabId, { type: 'X_PUBLISH' });
    await wait(1800);
    const after = await inspectTab(tabId);
    if (!result?.ok) throw new Error(result?.reason ?? 'PUBLISH_FAILED');
    const finalStatus = after.composerFound && after.contentPresent ? 'PUBLISHED_UNVERIFIED' : 'PUBLISHED';
    const finishedAt = Date.now();
    const nextRunAt = finishedAt + session.intervalMinutes * 60_000;
    const nextState = await updateState((current) => ({
      ...current,
      queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: finalStatus, publishedAt: finishedAt, updatedAt: finishedAt, operationId: undefined } : candidate),
      session: current.session ? { ...current.session, status: 'WAITING', nextRunAt, updatedAt: finishedAt } : null,
      history: [...current.history, { id: crypto.randomUUID(), queueItemId: item.id, link: item.targetUrl, timestamp: finishedAt, attemptNumber: item.attempts + 1, action: 'PUBLISH', result: finalStatus }]
    }));
    await chrome.alarms.create(ALARM_NAME, { when: nextRunAt, persistAcrossSessions: true });
    await broadcast(nextState);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const current = await getState();
    const latestItem = current.queue.find((candidate) => candidate.id === item.id);
    const exhausted = !latestItem || latestItem.attempts >= session.maxRetries + 1;
    const failedStatus = exhausted ? 'FAILED' : 'PENDING';
    const nextItem = exhausted && session.failureBehavior === 'CONTINUE' ? getNextPendingItem(current.queue, item.id) : undefined;
    const nextRunAt = nextItem ? Date.now() + session.intervalMinutes * 60_000 : undefined;
    const nextStatus = exhausted && session.failureBehavior === 'PAUSE' ? 'PAUSED' : nextItem ? 'WAITING' : exhausted ? 'COMPLETED' : 'RUNNING';
    const failedState = await updateState((currentState) => ({
      ...currentState,
      queue: currentState.queue.map((candidate) => candidate.id === item.id ? { ...candidate, status: failedStatus, lastError: message, operationId: undefined, updatedAt: Date.now() } : candidate),
      session: currentState.session ? { ...currentState.session, status: nextStatus, currentItemId: nextItem?.id, currentIndex: nextItem?.position ?? currentState.session.currentIndex, nextRunAt, completedAt: nextStatus === 'COMPLETED' ? Date.now() : currentState.session.completedAt, updatedAt: Date.now() } : null,
      history: [...currentState.history, { id: crypto.randomUUID(), queueItemId: item.id, link: item.targetUrl, timestamp: Date.now(), attemptNumber: item.attempts + 1, action: 'PUBLISH', result: failedStatus, error: message }]
    }));
    if (nextRunAt) await chrome.alarms.create(ALARM_NAME, { when: nextRunAt, persistAcrossSessions: true });
    await broadcast(failedState);
    if (nextStatus === 'RUNNING') await processCurrentItem();
  }
}

async function advanceSession(): Promise<void> {
  const state = await getState();
  if (!state.session || state.session.status !== 'WAITING') return;
  const next = state.queue.find((item) => !isTerminalItem(item.status) && item.status !== 'FAILED');
  if (!next) {
    const completed = await updateState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'COMPLETED', completedAt: Date.now(), nextRunAt: undefined, updatedAt: Date.now() } : null }));
    await broadcast(completed);
    return;
  }
  const running = await updateState((current) => ({ ...current, session: current.session ? { ...current.session, status: 'RUNNING', currentItemId: next.id, currentIndex: next.position, nextRunAt: undefined, updatedAt: Date.now() } : null }));
  await broadcast(running);
  await processCurrentItem();
}

async function extractBank(bankUrl: string): Promise<AppState> {
  const tab = await chrome.tabs.create({ url: bankUrl, active: false });
  if (!tab.id) throw new Error('BANK_TAB_CREATE_FAILED');
  await waitForTabLoad(tab.id);
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({
    anchors: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => ({ raw: a.href, label: a.textContent?.trim() || undefined })),
    markup: document.documentElement.outerHTML
  }) });
  await chrome.tabs.remove(tab.id);
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
}

async function handleMessage(message: RuntimeMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_STATE': return getState();
    case 'EXTRACT_BANK': return extractBank(message.bankUrl);
    case 'UPDATE_SETTINGS': await saveSettings(message.settings); return updateState((state) => ({ ...state, session: state.session ? { ...state.session, ...message.settings, updatedAt: Date.now() } : state.session }));
    case 'START': {
      const settings = await getSettings();
      const state = await updateState((current) => ({ ...current, session: current.session ? { ...current.session, ...settings, status: 'RUNNING', startedAt: current.session.startedAt ?? Date.now(), currentItemId: current.session.currentItemId ?? current.queue.find((item) => item.status === 'PENDING')?.id, updatedAt: Date.now() } : null }));
      await broadcast(state); await processCurrentItem(); return getState();
    }
    case 'PAUSE': await chrome.alarms.clear(ALARM_NAME); return updateState((state) => ({ ...state, session: state.session ? { ...state.session, status: 'PAUSED', pausedAt: Date.now(), updatedAt: Date.now() } : null }));
    case 'RESUME': return handleMessage({ type: 'START' });
    case 'STOP': await chrome.alarms.clear(ALARM_NAME); return updateState((state) => ({ ...state, session: state.session ? { ...state.session, status: 'STOPPED', nextRunAt: undefined, updatedAt: Date.now() } : null }));
    case 'SKIP_CURRENT': return updateState((state) => ({ ...state, queue: state.queue.map((item) => item.id === state.session?.currentItemId ? { ...item, status: 'SKIPPED', updatedAt: Date.now() } : item) }));
    case 'RETRY_ITEM': return updateState((state) => ({ ...state, queue: state.queue.map((item) => item.id === message.itemId ? { ...item, status: 'PENDING', attempts: 0, lastError: undefined, updatedAt: Date.now() } : item) }));
    case 'DELETE_ITEM': return updateState((state) => ({ ...state, queue: state.queue.filter((item) => item.id !== message.itemId).map((item, index) => ({ ...item, position: index + 1 })) }));
    case 'CLEAR_COMPLETED': return updateState((state) => ({ ...state, queue: state.queue.filter((item) => !isTerminalItem(item.status)).map((item, index) => ({ ...item, position: index + 1 })) }));
    case 'REORDER': return updateState((state) => { const index = state.queue.findIndex((item) => item.id === message.itemId); const target = message.direction === 'up' ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= state.queue.length) return state; const queue = [...state.queue]; [queue[index], queue[target]] = [queue[target], queue[index]]; return { ...state, queue: queue.map((item, position) => ({ ...item, position: position + 1 })) }; });
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => { handleMessage(message).then(sendResponse).catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' })); return true; });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void advanceSession(); });
chrome.runtime.onStartup.addListener(async () => { const state = await getState(); if (state.session?.status === 'WAITING' && state.session.nextRunAt) await chrome.alarms.create(ALARM_NAME, { when: state.session.nextRunAt, persistAcrossSessions: true }); });
chrome.runtime.onInstalled.addListener(() => { void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); });
