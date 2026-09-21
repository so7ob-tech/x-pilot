import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(names.filter((key) => store.has(key)).map((key) => [key, store.get(key)]));
      },
      async set(values) { for (const [key, value] of Object.entries(values)) store.set(key, value); },
      async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) store.delete(key); }
    }
  }
};

const repository = await import('../src/storage/storage-repository.ts');

test('migrates legacy state once into a default Workspace without deleting legacy keys', async () => {
  store.clear();
  store.set('xQueueState', {
    queue: [{ id: 'legacy-item', sourceBankUrl: 'https://bank.test', targetUrl: 'https://x.com/intent/post?text=hello', position: 1, status: 'PENDING', attempts: 0, createdAt: 1, updatedAt: 1 }],
    session: { id: 'legacy-session', bankUrl: 'https://bank.test', status: 'PAUSED', currentIndex: 0, total: 1, intervalMinutes: 2, maxRetries: 2, failureBehavior: 'CONTINUE', confirmBeforeStart: true, keepAutomationTabOpen: true, closeTabOnComplete: false, version: 1, updatedAt: 1 },
    history: [{ id: 'legacy-attempt', queueItemId: 'legacy-item', link: 'https://x.com/intent/post?text=hello', timestamp: 1, attemptNumber: 1, action: 'PUBLISH', result: 'FAILED' }]
  });
  store.set('xQueueSettings', { intervalMinutes: 5 });
  const firstMeta = await repository.getMeta();
  const migrated = await repository.getWorkspaceState(firstMeta.activeWorkspaceId);
  assert.equal(migrated.workspace.name, 'مساحة العمل الافتراضية');
  assert.equal(migrated.queue.length, 1);
  assert.equal(migrated.queue[0].workspaceId, firstMeta.activeWorkspaceId);
  assert.equal(migrated.session.workspaceId, firstMeta.activeWorkspaceId);
  assert.equal(migrated.history[0].workspaceId, firstMeta.activeWorkspaceId);
  assert.equal(migrated.session.intervalMinutes, 5);
  assert.equal(store.has('xQueueState'), true);
  const secondMeta = await repository.getMeta();
  assert.equal(secondMeta.activeWorkspaceId, firstMeta.activeWorkspaceId);
});

test('keeps Queue state isolated between Workspaces', async () => {
  store.clear();
  const first = await repository.createWorkspace('الأول');
  const second = await repository.createWorkspace('الثاني');
  await repository.updateWorkspaceState(first.workspaceId, (state) => ({ ...state, queue: [{ id: 'first-item', workspaceId: first.workspaceId, sourceBankUrl: '', targetUrl: '', position: 1, status: 'PENDING', attempts: 0, createdAt: 1, updatedAt: 1 }] }));
  const secondState = await repository.getWorkspaceState(second.workspaceId);
  assert.equal(secondState.queue.length, 0);
  assert.equal((await repository.getWorkspaceState(first.workspaceId)).queue[0].id, 'first-item');
});

test('allows only one automation Workspace owner at a time', async () => {
  store.clear();
  const first = await repository.createWorkspace('الأول');
  const second = await repository.createWorkspace('الثاني');
  await repository.claimAutomationOwner(first.workspaceId);
  await assert.rejects(() => repository.claimAutomationOwner(second.workspaceId), /AUTOMATION_OWNED_BY_OTHER_WORKSPACE/);
  assert.equal(await repository.getAutomationOwner(), first.workspaceId);
  await repository.releaseAutomationOwner(first.workspaceId);
  await repository.claimAutomationOwner(second.workspaceId);
  assert.equal(await repository.getAutomationOwner(), second.workspaceId);
});
