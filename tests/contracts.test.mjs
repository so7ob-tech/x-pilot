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
  assert.match(serviceWorker, /const nextRunAt = !exhausted \|\| nextItem \? Date\.now\(\) \+ session\.intervalMinutes/);
  assert.match(serviceWorker, /nextItem \? 'WAITING'/);
  assert.match(serviceWorker, /if \(nextRunAt\) await chrome\.alarms\.create/);
});

test('Pause clears the active alarm and Resume recreates a waiting alarm', () => {
  assert.match(serviceWorker, /case 'PAUSE': \{[\s\S]*chrome\.alarms\.clear\(ALARM_NAME\)/);
  assert.match(serviceWorker, /const nextRunAt = current\.session\.nextRunAt/);
  assert.match(serviceWorker, /const hasFutureAlarm = Boolean\(nextRunAt/);
  assert.match(serviceWorker, /if \(hasFutureAlarm && nextRunAt\) \{[\s\S]*chrome\.alarms\.create\(ALARM_NAME/);
});

test('startup and install listeners both invoke persisted-state recovery', () => {
  assert.match(serviceWorker, /chrome\.runtime\.onStartup\.addListener\(\(\) => \{ void recoverPersistedState\(\); \}\)/);
  assert.match(serviceWorker, /chrome\.runtime\.onInstalled\.addListener\(\(\) => \{[\s\S]*void recoverPersistedState\(\); \}\)/);
  assert.match(serviceWorker, /await chrome\.alarms\.clear\(ALARM_NAME\)/);
});

test('successful publish persists the next item before scheduling the wait', () => {
  assert.match(serviceWorker, /const nextItem = getNextPendingItem\(\(await getState\(\)\)\.queue, item\.id\)/);
  assert.match(serviceWorker, /currentItemId: nextItem\?\.id/);
  assert.match(serviceWorker, /const nextStatus = nextItem \? 'WAITING' : 'COMPLETED'/);
  assert.match(serviceWorker, /await chrome\.alarms\.clear\(ALARM_NAME\);\n    if \(nextRunAt\)/);
});

test('non-exhausted failures schedule a retry instead of recursively retrying', () => {
  assert.match(serviceWorker, /const nextRunAt = !exhausted \|\| nextItem \?/);
  assert.match(serviceWorker, /const nextStatus = exhausted && session\.failureBehavior === 'PAUSE' \? 'PAUSED' : nextItem \|\| !exhausted \? 'WAITING' : 'COMPLETED'/);
  assert.match(serviceWorker, /const nextItemId = nextItem\?\.id \?\? \(!exhausted \? item\.id : undefined\)/);
  assert.doesNotMatch(serviceWorker, /if \(nextStatus === 'RUNNING'\) await processCurrentItem\(\)/);
});

test('automation activates X before readiness polling and restores the previous tab', () => {
  assert.match(serviceWorker, /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/);
  assert.match(serviceWorker, /await chrome\.tabs\.update\(tabId, \{ url: item\.targetUrl, active: false \}\)/);
  assert.match(serviceWorker, /await waitForTabLoad\(tabId\);\n    await activateAutomationTab\(tabId\)/);
  assert.match(serviceWorker, /async function activateAutomationTab\(tabId: number\): Promise<void>/);
  assert.match(serviceWorker, /await restoreActiveTab\(previousActiveTabId\)/);
  assert.match(serviceWorker, /if \(tab\.status === 'complete'\) finish\(\)/);
});
