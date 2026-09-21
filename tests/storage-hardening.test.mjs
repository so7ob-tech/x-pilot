import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const storage = fs.readFileSync(path.join(root, 'src/storage/storage-repository.ts'), 'utf8');
const migrations = fs.readFileSync(path.join(root, 'src/storage/migrations.ts'), 'utf8');
const performance = fs.readFileSync(path.join(root, 'src/storage/storage-performance.ts'), 'utf8');

test('migration registry contains explicit ordered paths to the current schema', async () => {
  const module = await import('../src/storage/migrations.ts');
  assert.equal(module.CURRENT_SCHEMA_VERSION, 4);
  assert.deepEqual(module.getMigrationPath(3).map((step) => step.id), ['schema-3-to-4']);
  assert.deepEqual(module.getMigrationPath(2).map((step) => step.id), ['schema-2-to-3', 'schema-3-to-4']);
  assert.deepEqual(module.getMigrationPath(1).map((step) => step.id), ['legacy-to-v3', 'schema-3-to-4']);
  assert.deepEqual(module.getMigrationPath(4), []);
  assert.throws(() => module.getMigrationPath(5), /MIGRATION/);
});

test('storage uses logical key families rather than one application object', () => {
  for (const key of ['V4_META_KEY', 'V4_GLOBAL_SETTINGS_KEY', 'V4_WORKSPACE_PREFIX', 'V4_QUEUE_PREFIX', 'V4_SESSIONS_PREFIX', 'V4_ATTEMPTS_PREFIX']) assert.match(storage, new RegExp(key));
  assert.match(storage, /xPilot:workspace:/);
  assert.match(storage, /xPilot:queue:/);
  assert.match(storage, /xPilot:attempts:/);
});

test('storage timing is non-persistent and reports only operation metadata', () => {
  assert.match(performance, /timedStorageOperation/);
  assert.match(performance, /console\.debug/);
  assert.doesNotMatch(performance, /chrome\.storage/);
  assert.doesNotMatch(performance, /targetUrl|tweet|contentFingerprint/);
});

test('repository enforces the migration path before schema transitions', () => {
  assert.match(storage, /validateMigrationRegistry\(CURRENT_SCHEMA_VERSION\)/);
  assert.match(storage, /getMigrationPath\(3, CURRENT_SCHEMA_VERSION\)/);
  assert.match(storage, /getMigrationPath\(2, CURRENT_SCHEMA_VERSION\)/);
  assert.match(storage, /getMigrationPath\(1, CURRENT_SCHEMA_VERSION\)/);
});
