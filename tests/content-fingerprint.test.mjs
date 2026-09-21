import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTweetContent, normalizeTweetContent, sha256Hex } from '../src/domain/content-fingerprint.ts';
import { classifyBankDiff, mergeSelectedDiffItems } from '../src/domain/bank-diff.ts';

const bank = { id: 'bank-1', workspaceId: 'workspace-1', name: 'Campaign', url: 'https://bank.example', favorite: false, archived: false, createdAt: 1, updatedAt: 1 };
const queueItem = { id: 'published-1', workspaceId: 'workspace-remote', sourceBankUrl: bank.url, targetUrl: 'https://x.com/intent/post?text=hello', position: 1, status: 'PUBLISHED', attempts: 1, createdAt: 1, updatedAt: 1 };

test('normalizes Unicode, entities, and whitespace consistently', () => {
  assert.equal(normalizeTweetContent('  Hello &amp;  world\n'), 'Hello & world');
  assert.equal(extractTweetContent('https://x.com/intent/post?text=Hello%20%20world'), 'Hello world');
});

test('produces stable SHA-256 fingerprints for equivalent content', async () => {
  const first = await sha256Hex(normalizeTweetContent('Hello  world'));
  const second = await sha256Hex(normalizeTweetContent(' Hello\nworld '));
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('marks content from another Workspace as a published duplicate and blocks it by default', async () => {
  const fingerprint = await sha256Hex('hello');
  const diff = classifyBankDiff('workspace-1', bank, [{ url: 'https://x.com/intent/post?text=hello', contentFingerprint: fingerprint, normalizedContent: 'hello' }], [], 10, new Map([[fingerprint, { item: { ...queueItem, contentFingerprint: fingerprint }, workspaceId: 'workspace-remote' }]]), 'BLOCK');
  assert.equal(diff.items[0].duplicateStatus, 'PUBLISHED_DUPLICATE');
  assert.equal(diff.selectedNewIds.length, 0);
  assert.equal(mergeSelectedDiffItems([], diff, bank, [diff.items[0].id], 20, 'BLOCK').length, 0);
});

test('Warn permits an explicitly selected queued duplicate but not a published duplicate', async () => {
  const queuedFingerprint = await sha256Hex('queued');
  const publishedFingerprint = await sha256Hex('published');
  const queue = [
    { ...queueItem, id: 'queued-1', status: 'PENDING', contentFingerprint: queuedFingerprint },
  ];
  const diff = classifyBankDiff('workspace-1', bank, [
    { url: 'https://x.com/intent/post?text=queued', contentFingerprint: queuedFingerprint, normalizedContent: 'queued' },
    { url: 'https://x.com/intent/post?text=published', contentFingerprint: publishedFingerprint, normalizedContent: 'published' },
  ], [], 10, new Map([
    [queuedFingerprint, { item: queue[0], workspaceId: 'workspace-1' }],
    [publishedFingerprint, { item: { ...queueItem, contentFingerprint: publishedFingerprint }, workspaceId: 'workspace-remote' }],
  ]), 'WARN');
  assert.equal(diff.selectedNewIds.length, 0);
  const queuedDuplicate = diff.items.find((item) => item.duplicateStatus === 'DUPLICATE');
  const publishedDuplicate = diff.items.find((item) => item.duplicateStatus === 'PUBLISHED_DUPLICATE');
  const merged = mergeSelectedDiffItems([], diff, bank, [queuedDuplicate.id, publishedDuplicate.id], 20, 'WARN');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].duplicateStatus, 'DUPLICATE');
});
