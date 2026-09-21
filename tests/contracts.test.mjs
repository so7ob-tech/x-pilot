import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(root, 'src/background/service-worker.ts'), 'utf8');
const contentEntry = fs.readFileSync(path.join(root, 'src/content/content-entry.ts'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src/ui/main.tsx'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

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

test('manifest declares official X-Pilot icon assets', () => {
  assert.equal(manifest.icons['16'], 'icons/icon16.png');
  assert.equal(manifest.icons['32'], 'icons/icon32.png');
  assert.equal(manifest.icons['48'], 'icons/icon48.png');
  assert.equal(manifest.icons['128'], 'icons/icon128.png');
  assert.equal(manifest.action.default_icon['16'], 'icons/icon16.png');
  for (const file of ['icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png', 'icons/icon256.png', 'branding/x-pilot-logo.png']) {
    assert.equal(fs.existsSync(path.join(root, 'public', file)), true, `missing ${file}`);
  }
});

test('UI and README use the official X-Pilot branding asset', () => {
  assert.match(uiSource, /branding\/x-pilot-logo\.png/);
  assert.match(uiSource, /X-PILOT SETTINGS/);
  assert.match(uiSource, /X-PILOT RECOVERY/);
  assert.match(readme, /public\/branding\/x-pilot-logo\.png/);
  assert.match(readme, /public\/icons/);
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

test('content injection is guarded per tab and cleaned on tab lifecycle events', () => {
  assert.match(serviceWorker, /const injectedContentTabs = new Set<number>\(\)/);
  assert.match(serviceWorker, /const contentInjectionInFlight = new Map<number, Promise<void>>\(\)/);
  assert.match(serviceWorker, /chrome\.tabs\.onUpdated\.addListener\(\(tabId, changeInfo\) => \{[\s\S]*injectedContentTabs\.delete\(tabId\)/);
  assert.match(serviceWorker, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{[\s\S]*contentInjectionInFlight\.delete\(tabId\)/);
  assert.match(serviceWorker, /async function ensureContentScript\(tabId: number\)/);
  assert.match(serviceWorker, /if \(existing\) return existing/);
  assert.match(serviceWorker, /await ensureContentScript\(tabId\)/);
});

test('content-entry installs only one runtime message listener per page', () => {
  assert.match(contentEntry, /__xPilotContentListenerInstalled/);
  assert.match(contentEntry, /if \(!contentGlobal\[listenerKey\]\)/);
});

test('bank extraction always removes its temporary tab in finally', () => {
  assert.match(serviceWorker, /async function extractBank\(bankUrl: string\)/);
  assert.match(serviceWorker, /let bankTabId: number \| undefined/);
  assert.match(serviceWorker, /finally \{[\s\S]*if \(bankTabId\) await chrome\.tabs\.remove\(bankTabId\)\.catch/);
});

test('automation tab cleanup respects settings and clears persisted references', () => {
  assert.match(serviceWorker, /async function closeAutomationTabIfConfigured\(session: AutomationSession\)/);
  assert.match(serviceWorker, /session\.closeTabOnComplete \|\| !session\.keepAutomationTabOpen/);
  assert.match(serviceWorker, /await chrome\.tabs\.remove\(tabId\)\.catch/);
  assert.match(serviceWorker, /await chrome\.storage\.local\.remove\(AUTOMATION_TAB_KEY\)/);
  assert.match(serviceWorker, /automationTabId: undefined/);
});

test('manual automation-tab removal clears only the matching session reference', () => {
  assert.match(serviceWorker, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{/);
  assert.match(serviceWorker, /state\.session\?\.automationTabId !== tabId/);
  assert.match(serviceWorker, /current\.session\?\.automationTabId === tabId/);
});

test('stop and completion paths clean the configured automation tab', () => {
  assert.match(serviceWorker, /case 'STOP': \{[\s\S]*closeAutomationTabIfConfigured/);
  assert.match(serviceWorker, /const visibleState = nextStatus === 'COMPLETED' && nextState\.session/);
  assert.match(serviceWorker, /const visibleState = completed\.session \? await closeAutomationTabIfConfigured/);
  assert.match(serviceWorker, /if \(current\.session\?\.status !== 'RUNNING' \|\| latestItem\?\.operationId !== operationId\)/);
});
