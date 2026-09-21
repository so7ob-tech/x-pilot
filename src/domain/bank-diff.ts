import type { BankDiffItem, BankDiffResult, BankSnapshotItem, QueueItem, TweetBank } from './models';

const isSupportedUrl = (url: string) => /^https?:\/\/\S+$/i.test(url.trim());
const key = (url: string) => url.trim();

export function classifyBankDiff(workspaceId: string, bank: TweetBank, refreshed: BankSnapshotItem[], queue: QueueItem[], refreshedAt = Date.now()): BankDiffResult {
  const queueByUrl = new Map(queue.map((item) => [key(item.targetUrl), item]));
  const seen = new Set<string>();
  const items: BankDiffItem[] = [];
  for (const candidate of refreshed) {
    const url = candidate.url.trim();
    if (seen.has(url)) continue;
    seen.add(url);
    if (!isSupportedUrl(url)) {
      items.push({ id: crypto.randomUUID(), url, label: candidate.label, category: 'INVALID', reason: 'INVALID_URL' });
      continue;
    }
    const existing = queueByUrl.get(url);
    if (!existing) items.push({ id: crypto.randomUUID(), url, label: candidate.label, category: 'NEW' });
    else if (existing.status === 'PUBLISHED' || existing.status === 'PUBLISHED_UNVERIFIED') items.push({ id: crypto.randomUUID(), url, label: candidate.label ?? existing.label, category: 'PREVIOUSLY_PUBLISHED', existingQueueItemId: existing.id });
    else items.push({ id: crypto.randomUUID(), url, label: candidate.label ?? existing.label, category: 'EXISTING', existingQueueItemId: existing.id });
  }
  const refreshedUrls = new Set(seen);
  for (const previous of bank.lastSnapshot ?? []) {
    const url = key(previous.url);
    if (url && !refreshedUrls.has(url)) items.push({ id: crypto.randomUUID(), url, label: previous.label, category: 'REMOVED', reason: 'MISSING_FROM_REFRESH' });
  }
  return { workspaceId, bankId: bank.id, refreshedAt, items, selectedNewIds: items.filter((item) => item.category === 'NEW').map((item) => item.id) };
}

export function mergeSelectedDiffItems(queue: QueueItem[], diff: BankDiffResult, bank: TweetBank, selectedIds: string[], now = Date.now()): QueueItem[] {
  const selected = new Set(selectedIds);
  const existingUrls = new Set(queue.map((item) => key(item.targetUrl)));
  const additions = diff.items.filter((item) => item.category === 'NEW' && selected.has(item.id) && !existingUrls.has(key(item.url))).map((item, index) => ({
    id: crypto.randomUUID(), workspaceId: diff.workspaceId, sourceBankId: bank.id, sourceBankUrl: bank.url, targetUrl: item.url, label: item.label, position: queue.length + index + 1, status: 'PENDING' as const, attempts: 0, createdAt: now, updatedAt: now,
  }));
  return [...queue, ...additions].map((item, index) => ({ ...item, position: index + 1 }));
}

export function diffCounts(result: BankDiffResult) {
  return result.items.reduce<Record<string, number>>((counts, item) => { counts[item.category] = (counts[item.category] ?? 0) + 1; return counts; }, {});
}
