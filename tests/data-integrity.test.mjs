import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintTweet } from '../src/domain/content-fingerprint.ts';
import { classifyAlarm, normalizeQueueItem, normalizeWorkspaceState, shouldNeverRepublish, validateWorkspaceIntegrity } from '../src/domain/data-integrity.ts';
import { normalizeRecovery } from '../src/domain/recovery.ts';

const session = (status, currentItemId, nextRunAt) => ({ id: 'session-1', workspaceId: 'workspace-1', bankUrl: 'https://bank.example', status, currentItemId, currentIndex: 1, total: 1, nextRunAt, intervalMinutes: 2, maxRetries: 2, failureBehavior: 'CONTINUE', confirmBeforeStart: true, keepAutomationTabOpen: true, closeTabOnComplete: false, version: 1, updatedAt: 1 });
const item = (status = 'PENDING') => ({ id: 'item-1', workspaceId: 'workspace-1', sourceBankId: 'bank-1', sourceBankUrl: 'https://bank.example', targetUrl: 'https://x.com/intent/post?text=Hello', position: 1, status, attempts: 1, createdAt: 1, updatedAt: 1 });
const workspace = { id: 'workspace-1', name: 'Test', description: '', favorite: false, archived: false, createdAt: 1, updatedAt: 1, lastActivityAt: 1 };

test('deleting a Bank does not invalidate immutable history references', () => {
  const state = { workspaceId: 'workspace-1', workspace, banks: [], queue: [item()], session: null, history: [{ id: 'attempt-1', workspaceId: 'workspace-1', queueItemId: 'item-1', link: item().targetUrl, timestamp: 2, attemptNumber: 1, action: 'PUBLISH', result: 'PUBLISHED' }], historicalSessions: [] };
  const report = validateWorkspaceIntegrity(state);
  assert.equal(report.valid, true);
  assert.ok(report.issues.some((issue) => issue.code === 'MISSING_BANK_REFERENCE'));
});

test('published Queue Items are never eligible for republishing', () => {
  assert.equal(shouldNeverRepublish(item('PUBLISHED')), true);
  assert.equal(shouldNeverRepublish({ ...item('PENDING'), publishedAt: 99 }), true);
  assert.equal(shouldNeverRepublish(item('PENDING')), false);
});

test('duplicate fingerprints remain equal after normalization', async () => {
  const first = await fingerprintTweet('https://x.com/intent/post?text=Hello%20%20world');
  const second = await fingerprintTweet('https://x.com/intent/post?text=Hello%20world');
  assert.equal(first?.fingerprint, second?.fingerprint);
});

test('restart during publishing/opening recovers to pending, never published', () => {
  const recovered = normalizeRecovery({ queue: [item('PUBLISHING')], session: session('RUNNING', 'item-1'), history: [] }, 100);
  assert.equal(recovered.queue[0].status, 'PENDING');
  assert.equal(recovered.session.status, 'PAUSED');
});

test('restart during future WAITING preserves the future schedule', () => {
  const recovered = normalizeRecovery({ queue: [item('PENDING')], session: session('WAITING',  'item-1', 2_000), history: [] }, 1_000);
  assert.equal(recovered.session.status, 'WAITING');
  assert.equal(recovered.session.nextRunAt, 2_000);
  assert.equal(classifyAlarm({ workspaceId: 'workspace-1', sessionId: 'session-1', status: 'WAITING', currentIndex: 1, total: 1, nextRunAt: 2_000, updatedAt: 1, version: 1 }, 'x-queue-next-item', 1_000), 'RECREATE_FUTURE');
});

test('old alarms and sessions are ignored safely', () => {
  assert.equal(classifyAlarm(null, 'x-queue-next-item'), 'IGNORE_STALE');
  assert.equal(classifyAlarm({ workspaceId: 'workspace-1', sessionId: 'session-1', status: 'COMPLETED', currentIndex: 1, total: 1, updatedAt: 1, version: 1 }, 'x-queue-next-item'), 'IGNORE_STALE');
  assert.equal(classifyAlarm({ workspaceId: 'workspace-1', sessionId: 'session-1', status: 'WAITING', alarmName: 'other-alarm', currentIndex: 1, total: 1, updatedAt: 1, version: 1 }, 'x-queue-next-item'), 'IGNORE_STALE');
});

test('corrupted and missing fields are isolated or defaulted', () => {
  assert.equal(normalizeQueueItem({ id: 'missing-target' }, 'workspace-1', 1), null);
  const normalized = normalizeWorkspaceState({ workspace, queue: [{ id: 'valid', targetUrl: 'https://x.com', status: 'UNKNOWN', attempts: -1 }] }, 'workspace-1', workspace, 10);
  assert.equal(normalized.queue.length, 1);
  assert.equal(normalized.queue[0].status, 'PENDING');
  assert.equal(normalized.queue[0].attempts, 0);
  assert.equal(normalized.session, null);
});

test('integrity reports duplicate Queue ids as errors and orphan history as warnings', () => {
  const state = { workspaceId: 'workspace-1', workspace, banks: [], queue: [item(), item()], session: null, history: [{ id: 'orphan', queueItemId: 'deleted-item', link: '', timestamp: 1, attemptNumber: 1, action: 'PUBLISH', result: 'FAILED' }], historicalSessions: [] };
  const report = validateWorkspaceIntegrity(state);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === 'DUPLICATE_QUEUE_ID'));
  assert.ok(report.issues.some((issue) => issue.code === 'ORPHAN_ATTEMPT'));
});

test('legacy backup missing newer fields can still be adapted by defaults', () => {
  const normalized = normalizeWorkspaceState({ workspace, banks: [], queue: [], history: [], historicalSessions: [] }, 'workspace-1', workspace);
  assert.deepEqual(normalized.queue, []);
  assert.deepEqual(normalized.historicalSessions, []);
});
