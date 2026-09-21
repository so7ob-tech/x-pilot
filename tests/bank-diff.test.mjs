import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBankDiff, mergeSelectedDiffItems } from '../src/domain/bank-diff.ts';

const bank = { id: 'bank-1', workspaceId: 'workspace-1', name: 'Campaign', url: 'https://bank.example', favorite: false, archived: false, createdAt: 1, updatedAt: 1, lastSnapshot: [{ url: 'https://x.com/old' }, { url: 'https://x.com/keep' }] };
const item = (id, url, status = 'PENDING') => ({ id, workspaceId: 'workspace-1', sourceBankId: 'bank-1', sourceBankUrl: bank.url, targetUrl: url, position: 1, status, attempts: 0, createdAt: 1, updatedAt: 1 });

test('classifies new, existing, previously published, removed, and invalid items', () => {
  const result = classifyBankDiff('workspace-1', bank, [{ url: 'https://x.com/new' }, { url: 'https://x.com/keep' }, { url: 'https://x.com/published' }, { url: 'not-a-url' }], [item('pending', 'https://x.com/keep'), item('published', 'https://x.com/published', 'PUBLISHED')], 10);
  assert.deepEqual(result.items.map((entry) => entry.category), ['NEW', 'EXISTING', 'PREVIOUSLY_PUBLISHED', 'INVALID', 'REMOVED']);
  assert.equal(result.selectedNewIds.length, 1);
  assert.equal(result.items.find((entry) => entry.category === 'REMOVED').url, 'https://x.com/old');
});

test('merges only selected new items and never duplicates URLs', () => {
  const diff = classifyBankDiff('workspace-1', bank, [{ url: 'https://x.com/new-a' }, { url: 'https://x.com/new-b' }], [], 10);
  const merged = mergeSelectedDiffItems([], diff, bank, [diff.items[0].id], 20);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceBankId, 'bank-1');
  const repeated = mergeSelectedDiffItems(merged, diff, bank, [diff.items[0].id], 30);
  assert.equal(repeated.length, 1);
});
