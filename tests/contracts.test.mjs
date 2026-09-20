import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(root, 'src/background/service-worker.ts'), 'utf8');

 test('package and manifest versions stay synchronized', () => {
  assert.equal(packageJson.version, manifest.version);
});

test('manifest does not request credential or cookie access', () => {
  const permissions = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];
  assert.equal(permissions.includes('cookies'), false);
  assert.equal(permissions.includes('webRequest'), false);
  assert.equal(permissions.includes('debugger'), false);
});

test('manifest declares the persistent workflow APIs', () => {
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.background?.service_worker);
  assert.ok(manifest.side_panel?.default_path);
});

test('failed Continue path schedules the next item and its countdown alarm', () => {
  assert.match(serviceWorker, /const nextRunAt = nextItem \? Date\.now\(\) \+ session\.intervalMinutes/);
  assert.match(serviceWorker, /nextItem \? 'WAITING'/);
  assert.match(serviceWorker, /if \(nextRunAt\) await chrome\.alarms\.create/);
});
