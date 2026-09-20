import type { QueueItemStatus, SessionStatus } from './models';

export function canStartItem(status: QueueItemStatus): boolean {
  return status === 'PENDING' || status === 'FAILED';
}

export function isTerminalItem(status: QueueItemStatus): boolean {
  return status === 'PUBLISHED' || status === 'PUBLISHED_UNVERIFIED' || status === 'SKIPPED';
}

export function nextSessionStatus(current: SessionStatus, command: 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'WAIT' | 'COMPLETE'): SessionStatus {
  if (command === 'START' || command === 'RESUME') return 'RUNNING';
  if (command === 'PAUSE') return 'PAUSED';
  if (command === 'STOP') return 'STOPPED';
  if (command === 'WAIT') return 'WAITING';
  if (command === 'COMPLETE') return 'COMPLETED';
  return current;
}
