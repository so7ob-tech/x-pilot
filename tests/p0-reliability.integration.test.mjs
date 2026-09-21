import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecovery } from '../src/domain/recovery.ts';
import { shouldNeverRepublish } from '../src/domain/data-integrity.ts';
import { decideAlarmFailure } from '../src/domain/alarm-recovery.ts';

const queueItem = (status = 'PENDING', extra = {}) => ({
  id: 'item-1', workspaceId: 'workspace-1', sourceBankUrl: 'https://bank.example', targetUrl: 'https://x.com/intent/post?text=Hello',
  position: 1, status, attempts: 1, createdAt: 1, updatedAt: 1, ...extra,
});
const session = (status, currentItemId = 'item-1', extra = {}) => ({
  id: 'session-1', workspaceId: 'workspace-1', bankUrl: 'https://bank.example', status, currentItemId, currentIndex: 1, total: 1,
  intervalMinutes: 2, maxRetries: 2, failureBehavior: 'CONTINUE', confirmBeforeStart: true, keepAutomationTabOpen: true,
  closeTabOnComplete: false, version: 1, updatedAt: 1, ...extra,
});

function installChromeStorage(initial = {}) {
  const data = { ...initial };
  let failCanonicalWrites = false;
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: '0.25.7' }) },
    storage: { local: {
      async get(keys) {
        if (keys === null) return { ...data };
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(requested.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
      },
      async set(values) {
        if (failCanonicalWrites && Object.keys(values).some((key) => key.startsWith('xPilot:meta'))) throw new Error('SIMULATED_COMMIT_FAILURE');
        Object.assign(data, values);
      },
      async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key]; },
    } },
  };
  return { data, failCommit: () => { failCanonicalWrites = true; } };
}

test('P0-1: an in-flight publish becomes PUBLISHED_UNVERIFIED and cannot be republished after restart', () => {
  const state = { queue: [queueItem('PUBLISHING', { operationId: 'op-1', publishIntentId: 'op-1', publishStartedAt: 10 })], session: session('RUNNING'), history: [] };
  const recovered = normalizeRecovery(state, 100);
  assert.equal(recovered.queue[0].status, 'PUBLISHED_UNVERIFIED');
  assert.equal(recovered.queue[0].publishIntentId, 'op-1');
  assert.equal(shouldNeverRepublish(recovered.queue[0]), true);
  assert.equal(recovered.session.status, 'PAUSED');
});

test('P0-2: persisted START lock allows one concurrent transition only', async () => {
  installChromeStorage();
  const { acquireStartLock, releaseStartLock } = await import('../src/storage/storage-repository.ts?start-lock-test');
  const results = await Promise.allSettled([acquireStartLock('workspace-a'), acquireStartLock('workspace-a')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason?.message === 'START_ALREADY_IN_FLIGHT').length, 1);
  const token = results.find((result) => result.status === 'fulfilled').value;
  await releaseStartLock(token);
});

test('P0-3: alarm failure policy retries with a future trigger and then fails explicitly', () => {
  const retry = decideAlarmFailure('WAITING', 5_000, 0, 1_000);
  assert.equal(retry.action, 'RETRY');
  assert.equal(retry.alarmName, 'x-queue-next-item');
  assert.equal(retry.when, 5_000);
  const exhausted = decideAlarmFailure('SCHEDULED', 5_000, 3, 1_000);
  assert.equal(exhausted.action, 'FAIL');
  assert.equal(exhausted.reason, 'ALARM_HANDLER_FAILED_AFTER_RETRIES');
});

test('P0-4: restore validation rejects duplicate IDs before any write', async () => {
  installChromeStorage();
  const { validateBackup } = await import('../src/storage/storage-repository.ts?backup-validation-test');
  const workspace = { id: 'workspace-1', name: 'A', description: '', favorite: false, archived: false, createdAt: 1, updatedAt: 1, lastActivityAt: 1 };
  const duplicateBank = { id: 'bank-1', workspaceId: 'workspace-1', name: 'B', url: 'https://bank.example', favorite: false, archived: false, createdAt: 1, updatedAt: 1 };
  const result = validateBackup({ format: 'x-pilot-backup', formatVersion: 2, createdAt: 1, meta: { schemaVersion: 4, activeWorkspaceId: 'workspace-1', workspaceOrder: ['workspace-1'] }, workspaces: [{ workspaceId: 'workspace-1', workspace, banks: [duplicateBank, duplicateBank], queue: [], session: null, history: [], historicalSessions: [] }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith('DUPLICATE_BANK_ID')));
});

test('P0-4: commit failure preserves the previous canonical state', async () => {
  const previousMeta = { schemaVersion: 4, activeWorkspaceId: 'old', workspaceOrder: ['old'], createdAt: 1, updatedAt: 1 };
  const previousWorkspace = { id: 'old', name: 'Old', description: '', favorite: false, archived: false, createdAt: 1, updatedAt: 1, lastActivityAt: 1 };
  const harness = installChromeStorage({
    'xPilot:meta': previousMeta,
    'xPilot:settings:global': { intervalMinutes: 2 },
    'xPilot:workspace:old': previousWorkspace,
    'xPilot:workspace-settings:old': { workspaceId: 'old', overrides: {}, createdAt: 1, updatedAt: 1 },
    'xPilot:bank:old': [], 'xPilot:queue:old': [], 'xPilot:sessions:old': [], 'xPilot:attempts:old': [],
  });
  const { restoreBackup } = await import('../src/storage/storage-repository.ts?backup-transaction-test');
  const nextWorkspace = { ...previousWorkspace, id: 'new', name: 'New' };
  const backup = { format: 'x-pilot-backup', formatVersion: 2, createdAt: 2, meta: { schemaVersion: 4, activeWorkspaceId: 'new', workspaceOrder: ['new'] }, globalSettings: { intervalMinutes: 2 }, workspaces: [{ workspaceId: 'new', workspace: nextWorkspace, banks: [], queue: [], session: null, history: [], historicalSessions: [] }] };
  harness.failCommit();
  await assert.rejects(() => restoreBackup(backup, true), /SIMULATED_COMMIT_FAILURE/);
  assert.deepEqual(harness.data['xPilot:meta'], previousMeta);
  assert.deepEqual(harness.data['xPilot:workspace:old'], previousWorkspace);
});

test('P0-4: successful commit removes staging records and orphan staging is safe to clean', async () => {
  const workspace = { id: 'workspace-1', name: 'Workspace', description: '', favorite: false, archived: false, createdAt: 1, updatedAt: 1, lastActivityAt: 1 };
  const harness = installChromeStorage({
    'xPilot:meta': { schemaVersion: 4, activeWorkspaceId: 'workspace-1', workspaceOrder: ['workspace-1'], createdAt: 1, updatedAt: 1 },
    'xPilot:settings:global': { intervalMinutes: 2 }, 'xPilot:workspace:workspace-1': workspace,
    'xPilot:workspace-settings:workspace-1': { workspaceId: 'workspace-1', overrides: {}, createdAt: 1, updatedAt: 1 },
    'xPilot:bank:workspace-1': [], 'xPilot:queue:workspace-1': [], 'xPilot:sessions:workspace-1': [], 'xPilot:attempts:workspace-1': [],
    'xPilot:restore:staging:orphan:manifest': { transactionId: 'orphan' },
  });
  const { cleanupRestoreStaging, restoreBackup } = await import('../src/storage/storage-repository.ts?backup-cleanup-test');
  await cleanupRestoreStaging();
  assert.equal(Object.keys(harness.data).some((key) => key.startsWith('xPilot:restore:staging:')), false);
  const backup = { format: 'x-pilot-backup', formatVersion: 2, createdAt: 2, meta: { schemaVersion: 4, activeWorkspaceId: 'workspace-1', workspaceOrder: ['workspace-1'] }, globalSettings: { intervalMinutes: 2 }, workspaces: [{ workspaceId: 'workspace-1', workspace, banks: [], queue: [], session: null, history: [], historicalSessions: [] }] };
  await restoreBackup(backup, true);
  assert.equal(Object.keys(harness.data).some((key) => key.startsWith('xPilot:restore:staging:')), false);
});

test('P0-5: overdue scheduled session is paused for explicit safe resume, never left scheduled', () => {
  const recovered = normalizeRecovery({ queue: [queueItem('PENDING')], session: session('SCHEDULED', 'item-1', { scheduledStartAt: 900, nextRunAt: 900 }), history: [] }, 1_000);
  assert.equal(recovered.session.status, 'PAUSED');
  assert.equal(recovered.session.scheduledStartAt, undefined);
  assert.equal(recovered.session.lastAlarmError, 'SCHEDULED_START_MISSED_AFTER_RESTART');
});

test('P0-5: future scheduled session remains scheduled for alarm recreation', () => {
  const recovered = normalizeRecovery({ queue: [queueItem('PENDING')], session: session('SCHEDULED', 'item-1', { scheduledStartAt: 2_000, nextRunAt: 2_000 }), history: [] }, 1_000);
  assert.equal(recovered.session.status, 'SCHEDULED');
  assert.equal(recovered.session.scheduledStartAt, 2_000);
});
