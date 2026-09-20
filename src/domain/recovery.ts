import type { AppState, QueueItem } from './models';

const interruptedStatuses = new Set(['OPENING', 'READY', 'PUBLISHING']);
const terminalStatuses = new Set(['PUBLISHED', 'PUBLISHED_UNVERIFIED', 'SKIPPED']);

function isTerminalItem(status: QueueItem['status']): boolean {
  return terminalStatuses.has(status);
}

function getNextPendingItem(queue: QueueItem[], excludedItemId?: string): QueueItem | undefined {
  return [...queue].filter((item) => item.id !== excludedItemId && item.status === 'PENDING').sort((left, right) => left.position - right.position)[0];
}

function recoverQueueItem(item: QueueItem, now: number): QueueItem {
  if (!interruptedStatuses.has(item.status)) return item;
  return {
    ...item,
    status: 'PENDING',
    operationId: undefined,
    lastError: item.lastError ?? 'RECOVERED_AFTER_RESTART',
    updatedAt: now
  };
}

export function normalizeRecovery(state: AppState, now = Date.now()): AppState {
  if (!state.session) return state;
  const queue = state.queue.map((item) => recoverQueueItem(item, now));
  let session = { ...state.session, updatedAt: now };
  const current = session.currentItemId ? queue.find((item) => item.id === session.currentItemId) : undefined;
  const next = getNextPendingItem(queue, current?.id);

  if (session.status === 'RUNNING') {
    const resumable = current && !isTerminalItem(current.status) ? current : next;
    session = resumable
      ? { ...session, status: 'PAUSED', pausedAt: now, nextRunAt: undefined, currentItemId: resumable.id, currentIndex: resumable.position }
      : { ...session, status: 'COMPLETED', completedAt: now, nextRunAt: undefined, currentItemId: undefined };
  } else if (session.status === 'WAITING' && (!session.nextRunAt || session.nextRunAt <= now)) {
    const resumable = current && !isTerminalItem(current.status) ? current : next;
    session = resumable
      ? { ...session, status: 'PAUSED', pausedAt: now, nextRunAt: undefined, currentItemId: resumable.id, currentIndex: resumable.position }
      : { ...session, status: 'COMPLETED', completedAt: now, nextRunAt: undefined, currentItemId: undefined };
  } else if (session.status === 'PAUSED' && (!current || isTerminalItem(current.status))) {
    session = next
      ? { ...session, currentItemId: next.id, currentIndex: next.position }
      : { ...session, status: 'COMPLETED', completedAt: now, nextRunAt: undefined, currentItemId: undefined };
  }

  return { ...state, queue, session };
}

export function hasFutureRecoveryAlarm(state: AppState, now = Date.now()): boolean {
  return state.session?.status === 'WAITING' && Boolean(state.session.nextRunAt && state.session.nextRunAt > now);
}
