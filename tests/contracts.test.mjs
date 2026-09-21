import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(root, 'src/background/service-worker.ts'), 'utf8');
const contentEntry = fs.readFileSync(path.join(root, 'src/content/content-entry.ts'), 'utf8');
const uiSource = [
  'src/ui/main.tsx',
  'src/ui/types/navigation.ts',
  'src/ui/services/runtime-client.ts',
  'src/ui/components/operation-cards.tsx',
  'src/ui/tabs/OperationTab.tsx',
  'src/ui/tabs/StartupTestsTab.tsx',
  'src/ui/tabs/AnalyticsTab.tsx',
  'src/ui/tabs/DiagnosticsTab.tsx',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const models = fs.readFileSync(path.join(root, 'src/domain/models.ts'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'src/storage/storage-repository.ts'), 'utf8');
const pagination = fs.readFileSync(path.join(root, 'src/domain/pagination.ts'), 'utf8');
const errorMessages = fs.readFileSync(path.join(root, 'src/ui/services/error-messages.ts'), 'utf8');

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

test('daily X posting limit pauses the session without advancing the Queue', () => {
  assert.match(models, /dailyPostLimitReached\?: boolean/);
  assert.match(serviceWorker, /X_DAILY_POST_LIMIT_REACHED/);
  assert.match(serviceWorker, /status: 'PAUSED', currentItemId: item\.id, nextRunAt: undefined/);
  assert.match(serviceWorker, /status: 'PENDING', attempts: item\.attempts/);
  assert.match(serviceWorker, /chrome\.alarms\.clear\(ALARM_NAME\)/);
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
  assert.match(uiSource, /common\.xPilotSettings/);
  assert.match(uiSource, /X-PILOT/);
  assert.match(readme, /public\/branding\/x-pilot-logo\.png/);
  assert.match(readme, /public\/icons/);
});

test('Side Panel exposes operation, startup-tests, tweet-bank, sessions, history, analytics, and settings tabs', () => {
  assert.match(uiSource, /type TabId = 'operation' \| 'tests' \| 'queue' \| 'sessions' \| 'history' \| 'analytics' \| 'diagnostics' \| 'workspaces' \| 'settings'/);
  assert.match(uiSource, /aria-label=\{t\('nav\.operation'\)\}/);
  assert.match(uiSource, /label=\{t\('nav\.operation'\)\}/);
  assert.match(uiSource, /label=\{t\('nav\.banks'\)\}/);
  assert.match(uiSource, /label=\{t\('nav\.settings'\)\}/);
  assert.match(uiSource, /useState<TabId>\('operation'\)/);
  assert.match(uiSource, /label=\{t\('nav\.startupTests'\)\}/);
  assert.match(uiSource, /label=\{t\('nav\.analytics'\)\}/);
});

test('operation tab includes current-tweet information and existing controls', () => {
  assert.match(uiSource, /export function CurrentTweetCard/);
  assert.match(uiSource, /CurrentTweetCard/);
  assert.match(uiSource, /getTweetPreview\(item\.targetUrl, item\.label, 180\)/);
  assert.match(uiSource, /aria-label=\{t\('nav\.operation'\)\}/);
  assert.match(uiSource, /onClick=\{start\}/);
  assert.match(uiSource, /type: 'PAUSE'/);
  assert.match(uiSource, /type: 'RESUME'/);
  assert.match(uiSource, /type: 'STOP'/);
});

test('Service Worker exposes live engine and automation-tab connectivity status', () => {
  assert.match(serviceWorker, /async function getRuntimeStatus\(\): Promise<RuntimeStatus>/);
  assert.match(serviceWorker, /case 'GET_RUNTIME_STATUS': return getRuntimeStatus\(\)/);
  assert.match(serviceWorker, /connection: 'NOT_REQUIRED'/);
  assert.match(serviceWorker, /connection: 'CONNECTED'/);
  assert.match(serviceWorker, /connection: 'DISCONNECTED'/);
  assert.match(serviceWorker, /await chrome\.tabs\.get\(session\.automationTabId\)/);
});

test('Dry Run exposes both modes and does not use the publish action', () => {
  assert.match(models, /DryRunItemStatus/);
  assert.match(models, /DRY_RUN_FIRST/);
  assert.match(models, /DRY_RUN_QUEUE/);
  assert.match(uiSource, /runDryRunFirst/);
  assert.match(uiSource, /runDryRunQueue/);
  const runner = serviceWorker.slice(serviceWorker.indexOf('async function runDryRun'), serviceWorker.indexOf('async function waitForPublishReady'));
  assert.doesNotMatch(runner, /X_PUBLISH/);
  assert.doesNotMatch(runner, /addAttempt/);
});

test('Full Backup / Restore validates before replacing local data', () => {
  assert.match(models, /interface BackupEnvelope/);
  assert.match(models, /EXPORT_BACKUP/);
  assert.match(models, /VALIDATE_BACKUP/);
  assert.match(models, /RESTORE_BACKUP/);
  assert.match(storage, /export async function exportBackup/);
  assert.match(storage, /export function validateBackup/);
  assert.match(storage, /export async function restoreBackup/);
  assert.match(serviceWorker, /BACKUP_RESTORE_WHILE_AUTOMATION_ACTIVE/);
  assert.match(uiSource, /تصدير نسخة كاملة/);
  assert.match(uiSource, /استعادة نسخة JSON/);
});

test('Phase 2 exposes persistent scheduling, profiles, notifications, and Badge controls', () => {
  assert.match(models, /SCHEDULED/);
  assert.match(models, /SCHEDULE/);
  assert.match(models, /RESCHEDULE/);
  assert.match(models, /CANCEL_SCHEDULE/);
  assert.match(models, /publishingWindows/);
  assert.match(models, /badgeMode/);
  assert.match(serviceWorker, /SCHEDULE_ALARM_NAME/);
  assert.match(serviceWorker, /chrome\.alarms\.create\(SCHEDULE_ALARM_NAME/);
  assert.match(serviceWorker, /getNextAllowedPublishingTime/);
  assert.match(serviceWorker, /chrome\.notifications\.create/);
  assert.match(serviceWorker, /فشل عنصر/);
  assert.match(serviceWorker, /chrome\.action\.setBadgeText/);
  assert.match(uiSource, /ui\.schedule/);
  assert.match(uiSource, /ui\.reschedule/);
  assert.match(uiSource, /PublishingWindowsEditor/);
  assert.match(fs.readFileSync(path.join(root, 'src/ui/components/publishing-windows-editor.tsx'), 'utf8'), /type="time"/);
  assert.match(fs.readFileSync(path.join(root, 'src/ui/components/publishing-windows-editor.tsx'), 'utf8'), /إضافة نافذة/);
});

test('Dry Run results show item number and preview without exposing target URLs', () => {
  assert.match(models, /DryRunItemResult \{ queueItemId: string; position: number/);
  assert.match(serviceWorker, /position: item\.position/);
  assert.match(uiSource, /العنصر #\{item\.position\}/);
  assert.match(uiSource, /getDryRunPreview\(item\.targetUrl\)/);
  assert.doesNotMatch(uiSource.slice(uiSource.indexOf('export function DryRunCard'), uiSource.indexOf('export function CurrentTweetCard')), /item\.targetUrl\}\/span>/);
});

test('Scheduled Alarm creates a session when Queue has no prior session and reports empty Queue', () => {
  assert.match(serviceWorker, /current\.session \?\? \{/);
  assert.match(serviceWorker, /status: 'SCHEDULED'/);
  assert.match(serviceWorker, /لا يوجد عنصر Queue قابل للتشغيل/);
  assert.match(serviceWorker, /handleScheduledStart/);
});

test('Preflight automatically opens X and inspects readiness without publishing', () => {
  assert.match(serviceWorker, /async function performPreflight/);
  assert.match(serviceWorker, /state\.queue\.find\(\(item\) => canStartItem\(item\.status\)/);
  assert.match(serviceWorker, /chrome\.tabs\.create\(\{ url: 'about:blank', active: false \}\)/);
  assert.match(serviceWorker, /chrome\.tabs\.update\(temporary\.id, \{ url: targetUrl, active: false \}\)/);
  assert.match(serviceWorker, /await waitForTabLoad\(temporary\.id\)/);
  assert.match(serviceWorker, /xInspection = await inspectTab\(temporary\.id\)/);
  assert.match(serviceWorker, /finally \{\s*if \(temporaryTabId !== undefined\) await chrome\.tabs\.remove/);
  assert.match(uiSource, /اضغط فحص الآن؛ سيقوم X-Pilot بفتح تبويب X تلقائيًا/);
  assert.match(uiSource, /className="preflight-icon"/);
});

test('Feature 13 exposes shared advanced search filters across all entity views', () => {
  assert.match(uiSource, /SearchToolbar/);
  assert.match(uiSource, /label="الجلسات"/);
  assert.match(uiSource, /label="السجل"/);
  assert.match(uiSource, /filterQueue/);
  assert.match(uiSource, /filterBanks/);
  assert.match(uiSource, /filterSessions/);
  assert.match(uiSource, /filterHistory/);
  assert.match(uiSource, /فلترة حسب الحالة/);
  assert.match(uiSource, /فلترة حسب البنك/);
  assert.match(uiSource, /فلترة حسب الجلسة/);
  assert.match(uiSource, /فلترة حسب Workspace/);
  assert.match(uiSource, /من تاريخ/);
  assert.match(uiSource, /إلى تاريخ/);
  assert.match(models, /sessionId\?: string/);
});

test('Feature 14 exposes all Bulk Queue actions with active-item protection', () => {
  assert.match(models, /BulkQueueAction/);
  for (const action of ['BULK_ACTION', 'DELETE', 'SKIP', 'RETRY', 'RESET_PENDING', 'MOVE_TOP', 'MOVE_BOTTOM', 'ASSIGN_BANK', 'EXPORT']) assert.match(models, new RegExp(action));
  assert.match(serviceWorker, /executeBulkAction/);
  assert.match(serviceWorker, /BULK_ACTIVE_ITEM_CONFIRMATION_REQUIRED/);
  assert.match(serviceWorker, /BULK_ACTIVE_ITEM_BUSY/);
  assert.match(serviceWorker, /BULK_BANK_NOT_FOUND_OR_ARCHIVED/);
  assert.match(uiSource, /تحديد عناصر الصفحة/);
  assert.match(uiSource, /common\.resetPending/);
  assert.match(uiSource, /common\.moveTop/);
  assert.match(uiSource, /common\.moveBottom/);
  assert.match(uiSource, /common\.assignBank/);
  assert.match(uiSource, /common\.exportSelected/);
});

test('Individual Queue mutations persist, broadcast, and clear stale selection after deletion', () => {
  assert.match(serviceWorker, /async function commitQueueMutation/);
  assert.match(serviceWorker, /case 'DELETE_ITEM': return commitQueueMutation/);
  assert.match(serviceWorker, /case 'REORDER': return commitQueueMutation/);
  assert.match(serviceWorker, /await broadcast\(next\)/);
  assert.match(uiSource, /const queueAction = async/);
  assert.match(uiSource, /message\.type === 'DELETE_ITEM'/);
  assert.match(uiSource, /onAction=\{queueAction\}/);
});

test('Start creates a session when missing and automation-tab failure cannot leave an item stuck', () => {
  assert.match(serviceWorker, /case 'START':/);
  assert.match(serviceWorker, /const firstItem = current\.queue\.find\(\(item\) => canStartItem\(item\.status\)/);
  assert.match(serviceWorker, /const session(?:: AutomationSession)? = current\.session \?\? \{/);
  assert.match(serviceWorker, /let tabId: number \| undefined/);
  assert.match(serviceWorker, /tabId = await getOrCreateAutomationTab\(session\)/);
  assert.match(serviceWorker, /const failedStatus = exhausted \? 'FAILED' : 'PENDING'/);
});

test('Feature 15 exposes derived Workspace and global Analytics Dashboard metrics', () => {
  assert.match(uiSource, /AnalyticsTab/);
  assert.match(uiSource, /Total sessions/);
  assert.match(uiSource, /Success Rate/);
  assert.match(uiSource, /Average session duration/);
  assert.match(uiSource, /Most active bank/);
  assert.match(uiSource, /Total Workspaces/);
  assert.match(uiSource, /Sessions over time/);
  assert.match(uiSource, /ولا يتم تخزين إحصاءات مكررة/);
  assert.match(uiSource, /calculateGlobalAnalytics/);
  assert.match(uiSource, /calculateWorkspaceAnalytics/);
});

test('Feature 16 exposes a read-only Diagnostics Center with no publish path', () => {
  assert.match(models, /DiagnosticsCheckStatus/);
  assert.match(models, /RUN_DIAGNOSTICS/);
  assert.match(serviceWorker, /async function runDiagnostics/);
  assert.match(serviceWorker, /X_INSPECT/);
  assert.match(serviceWorker, /finally/);
  assert.match(serviceWorker, /DIAGNOSTICS_INSPECTION_FAILED/);
  assert.doesNotMatch(serviceWorker.slice(serviceWorker.indexOf('async function runDiagnostics'), serviceWorker.indexOf('function classifyDryRunInspection')), /X_PUBLISH|processCurrentItem|START/);
  assert.match(uiSource, /type TabId = 'operation' \| 'tests' \| 'queue' \| 'sessions' \| 'history' \| 'analytics' \| 'diagnostics'/);
  assert.match(uiSource, /label=\{t\('nav\.diagnostics'\)\}/);
  assert.match(uiSource, /diagnostics\.run/);
  assert.match(uiSource, /diagnostics\.readOnly/);
});

test('tab bar renders accessible live connection and engine indicators', () => {
  assert.match(uiSource, /GET_RUNTIME_STATUS/);
  assert.match(uiSource, /window\.setInterval\(\(\) => void refreshRuntimeStatus\(\), 1500\)/);
  assert.match(uiSource, /function StatusIndicator/);
  assert.match(uiSource, /statuses\.\$\{runtimeStatus\.connection\}/);
  assert.match(uiSource, /statuses\.\$\{runtimeStatus\.engineStatus\}/);
  assert.match(uiSource, /aria-live="polite"/);
  assert.match(uiSource, /runtime-warning/);
});

test('failed Continue path schedules the next item and its countdown alarm', () => {
  assert.match(serviceWorker, /const nextRunAt = !exhausted \|\| nextItem \?/);
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
  assert.match(serviceWorker, /async function extractBank\(bankUrl: string, workspaceId: string, mode: 'REPLACE' \| 'APPEND'/);
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

test('Workspace domain model includes independent entities and ownership metadata', () => {
  assert.match(models, /export interface Workspace \{/);
  assert.match(models, /export interface TweetBank \{/);
  assert.match(models, /export interface WorkspaceState extends AppState/);
  assert.match(models, /export interface AppMetaState \{/);
  assert.match(models, /automationWorkspaceId\?: string/);
  assert.match(models, /workspaceId\?: string/);
});

test('storage migration preserves legacy data and creates an idempotent default Workspace', () => {
  assert.match(storage, /LEGACY_STATE_KEY = 'xQueueState'/);
  assert.match(storage, /LEGACY_SETTINGS_KEY = 'xQueueSettings'/);
  assert.match(storage, /META_KEY = 'xPilotMeta'/);
  assert.match(storage, /schemaVersion: 3/);
  assert.match(storage, /مساحة العمل الافتراضية/);
  assert.match(storage, /await chrome\.storage\.local\.set\(\{ \[workspaceKey\(workspace\.id\)\]: migrated, \[META_KEY\]: meta \}\)/);
  assert.match(storage, /if \(existing\?\.schemaVersion === 2\)/);
});

test('Workspace runtime operations expose explicit ownership and management APIs', () => {
  assert.match(storage, /export async function claimAutomationOwner/);
  assert.match(storage, /AUTOMATION_OWNED_BY_OTHER_WORKSPACE/);
  assert.match(storage, /export async function releaseAutomationOwner/);
  assert.match(serviceWorker, /await claimAutomationOwner\(workspaceId\)/);
  assert.match(serviceWorker, /GET_WORKSPACES/);
  assert.match(serviceWorker, /SET_ACTIVE_WORKSPACE/);
  assert.match(uiSource, /type TabId = 'operation' \| 'tests' \| 'queue' \| 'sessions' \| 'history' \| 'analytics' \| 'diagnostics' \| 'workspaces' \| 'settings'/);
  assert.match(uiSource, /function WorkspaceCard/);
});

test('Workspace extraction does not silently overwrite Queue data', () => {
  assert.match(serviceWorker, /QUEUE_REPLACE_WHILE_ACTIVE/);
  assert.match(serviceWorker, /QUEUE_REPLACE_HAS_EXECUTED_ITEMS/);
  assert.match(serviceWorker, /existingUrls/);
  assert.match(uiSource, /إضافة روابط جديدة فقط/);
  assert.match(uiSource, /تحتوي Queue على عناصر منشورة/);
  assert.match(uiSource, /onRestore/);
});

test('Multiple Tweet Banks remain explicit and Workspace-scoped', () => {
  assert.match(models, /sourceBankId\?: string/);
  assert.match(models, /description\?: string; url: string; favorite: boolean; archived: boolean/);
  assert.match(models, /CREATE_BANK/);
  assert.match(models, /UPDATE_BANK/);
  assert.match(models, /ARCHIVE_BANK/);
  assert.match(models, /DELETE_BANK/);
  assert.match(storage, /export async function listBanks\(workspaceId: string/);
  assert.match(storage, /export async function createBank\(workspaceId: string/);
  assert.match(storage, /CANNOT_DELETE_RUNNING_BANK/);
  assert.match(serviceWorker, /case 'GET_BANKS'/);
  assert.match(serviceWorker, /sourceBankId: bankId/);
  assert.match(uiSource, /className=\{`bank-card/);
  assert.match(uiSource, /إضافة بنك/);
});

test('Refresh Diff is non-destructive and supports selective Queue merge', () => {
  assert.match(models, /BankDiffResult/);
  assert.match(models, /REFRESH_BANK/);
  assert.match(models, /ADD_DIFF_ITEMS/);
  assert.match(models, /DISCARD_BANK_DIFF/);
  assert.match(serviceWorker, /async function refreshBank\(workspaceId: string, bankId: string\)/);
  assert.match(serviceWorker, /classifyBankDiff\(workspaceId, bank, snapshot, state.queue,/);
  assert.match(serviceWorker, /mergeSelectedDiffItems\(workspaceState.queue, diff, bank, message.itemIds,/);
  assert.match(uiSource, /ui\.refreshDiff/);
  assert.match(uiSource, /إضافة المحدد إلى Queue/);
  assert.match(uiSource, /مراجعة تغييرات البنك/);
});

test('Duplicate Protection exposes SHA-256 fingerprints and policy controls', () => {
  assert.match(models, /contentFingerprint/);
  assert.match(models, /DuplicatePolicy/);
  assert.match(models, /duplicatePolicy: DuplicatePolicy/);
  assert.match(serviceWorker, /fingerprintTweet/);
  assert.match(serviceWorker, /fingerprintIndex/);
  assert.match(uiSource, /settings\.duplicatePolicy/);
  assert.match(uiSource, /سبق نشر هذا المحتوى/);
  assert.match(uiSource, /محتوى مكرر/);
});

test('Preflight Check exposes structured checks and guards Start', () => {
  assert.match(models, /PREFLIGHT_CHECK/);
  assert.match(serviceWorker, /performPreflight/);
  assert.match(serviceWorker, /PREFLIGHT_FAILED/);
  assert.match(uiSource, /tests\.preflight/);
  assert.match(uiSource, /فحص الآن/);
});

test('Queue exposes selectable page sizes and previous/next pagination', () => {
  assert.match(pagination, /export type PageSize = 10 \| 50 \| 100 \| 'ALL'/);
  assert.match(uiSource, /عدد عناصر Queue في الصفحة/);
  assert.match(uiSource, /value="10"/);
  assert.match(uiSource, /value="50"/);
  assert.match(uiSource, /value="100"/);
  assert.match(uiSource, /value="ALL"/);
  assert.match(uiSource, /pagination-controls/);
  assert.match(uiSource, /setQueuePage\(\(current\) => Math\.max\(1, current - 1\)\)/);
  assert.match(uiSource, /setQueuePage\(\(current\) => Math\.min\(queuePageCount, current \+ 1\)\)/);
});

test('daily-limit internal code is translated only at the UI presentation boundary', () => {
  assert.match(errorMessages, /X_DAILY_POST_LIMIT_REACHED/);
  assert.match(errorMessages, /لقد وصلت إلى الحد الأقصى لعدد المنشورات اليومية/);
  assert.match(uiSource, /getUserFacingMessage/);
});
