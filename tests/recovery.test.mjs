import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFutureRecoveryAlarm, normalizeRecovery } from '../src/domain/recovery.ts';

const item = (id, position, status) => ({
  id,
  position,
  status,
  sourceBankUrl: 'https://bank.example',
  targetUrl: `https://x.com/intent/post?text=${id}`,
  attempts: 1,
  createdAt: 1,
  updatedAt: 1,
  operationId: status === 'OPENING' ? 'stale-operation' : undefined
});

const session = (status, currentItemId, nextRunAt) => ({
  id: 'session',
  bankUrl: 'https://bank.example',
  status,
  currentItemId,
  currentIndex: 1,
  total: 3,
  nextRunAt,
  intervalMinutes: 2,
  maxRetries: 2,
  failureBehavior: 'CONTINUE',
  confirmBeforeStart: true,
  keepAutomationTabOpen: true,
  closeTabOnComplete: false,
  version: 1,
  updatedAt: 1
});

test('normalizes interrupted items to pending and pauses a running session', () => {
  const state = { queue: [item('one', 1, 'OPENING'), item('two', 2, 'PENDING')], session: session('RUNNING', 'one'), history: [] };
  const recovered = normalizeRecovery(state, 100);
  assert.equal(recovered.queue[0].status, 'PENDING');
  assert.equal(recovered.queue[0].operationId, undefined);
  assert.equal(recovered.queue[0].lastError, 'RECOVERED_AFTER_RESTART');
  assert.equal(recovered.session.status, 'PAUSED');
  assert.equal(recovered.session.currentItemId, 'one');
});

test('keeps a future waiting session waiting and exposes one recoverable alarm', () => {
  const state = { queue: [item('one', 1, 'PUBLISHED'), item('two', 2, 'PENDING')], session: session('WAITING', 'two', 2_000), history: [] };
  const recovered = normalizeRecovery(state, 1_000);
  assert.equal(recovered.session.status, 'WAITING');
  assert.equal(hasFutureRecoveryAlarm(recovered, 1_000), true);
});

test('expired waiting state becomes paused instead of auto-publishing', () => {
  const state = { queue: [item('one', 1, 'PENDING')], session: session('WAITING', 'one', 900), history: [] };
  const recovered = normalizeRecovery(state, 1_000);
  assert.equal(recovered.session.status, 'PAUSED');
  assert.equal(recovered.session.nextRunAt, undefined);
});

test('published items are never re-queued during recovery', () => {
  const state = { queue: [item('published', 1, 'PUBLISHED')], session: session('PAUSED', 'published'), history: [] };
  const recovered = normalizeRecovery(state, 100);
  assert.equal(recovered.queue[0].status, 'PUBLISHED');
  assert.equal(recovered.session.status, 'COMPLETED');
});
