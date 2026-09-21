import type { BulkQueueAction, QueueItem } from './models';

export function reorderSelected(items: QueueItem[], selectedIds: string[], direction: 'TOP' | 'BOTTOM'): QueueItem[] {
  const selected = new Set(selectedIds);
  const chosen = items.filter((item) => selected.has(item.id));
  const remaining = items.filter((item) => !selected.has(item.id));
  const ordered = direction === 'TOP' ? [...chosen, ...remaining] : [...remaining, ...chosen];
  return ordered.map((item, index) => ({ ...item, position: index + 1, updatedAt: Date.now() }));
}

export function applyBulkStatus(items: QueueItem[], selectedIds: string[], action: Extract<BulkQueueAction, 'SKIP' | 'RETRY' | 'RESET_PENDING'>): QueueItem[] {
  const selected = new Set(selectedIds);
  return items.map((item) => {
    if (!selected.has(item.id)) return item;
    if (action === 'SKIP') return { ...item, status: 'SKIPPED', operationId: undefined, updatedAt: Date.now() };
    return { ...item, status: 'PENDING', attempts: 0, lastError: undefined, operationId: undefined, startedAt: undefined, updatedAt: Date.now() };
  });
}
