import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const models = fs.readFileSync(path.join(root, 'src/domain/models.ts'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'src/storage/storage-repository.ts'), 'utf8');
const architecture = fs.readFileSync(path.join(root, 'docs/data-architecture.md'), 'utf8');

test('schema v4 defines separate durable, runtime, and record entities', () => {
  for (const symbol of ['AppMetadata', 'GlobalSettings', 'WorkspaceSettings', 'AutomationSessionRuntime', 'AutomationSessionRecord', 'BankSnapshot', 'PublishAttempt']) assert.match(models, new RegExp(`interface ${symbol}`));
  assert.match(models, /schemaVersion: 2 \| 3 \| 4/);
  assert.match(storage, /V4_RUNTIME_KEY/);
  assert.match(storage, /V4_ATTEMPTS_PREFIX/);
  assert.match(storage, /V4_SESSIONS_PREFIX/);
});

test('schema v3 migration is idempotent by preferring canonical v4 metadata', () => {
  assert.match(storage, /async function migrateSchema3To4/);
  assert.match(storage, /if \(existing\?\.schemaVersion === 4\) return existing/);
  assert.match(storage, /return migrateSchema3To4\(existing\)/);
  assert.match(storage, /V4_RUNTIME_KEY/);
  assert.match(storage, /session: null/);
});

test('Workspace state remains a compatibility adapter over canonical stores', () => {
  assert.match(storage, /v4WorkspaceKey\(workspaceId\)/);
  assert.match(storage, /v4QueueKey\(workspaceId\)/);
  assert.match(storage, /v4SessionsKey\(workspaceId\)/);
  assert.match(storage, /v4AttemptsKey\(workspaceId\)/);
  assert.match(storage, /runtime\?\.workspaceId === workspaceId/);
});

test('architecture proposal documents the implementation boundaries', () => {
  assert.match(architecture, /schemaVersion: 4/);
  assert.match(architecture, /AutomationSessionRuntime/);
  assert.match(architecture, /PublishAttempt/);
  assert.match(architecture, /formatVersion: 2/);
});
