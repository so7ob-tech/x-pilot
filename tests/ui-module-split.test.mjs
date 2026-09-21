import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('UI is split into explicit tab modules without dynamic imports', () => {
  for (const file of [
    'src/ui/tabs/OperationTab.tsx',
    'src/ui/tabs/StartupTestsTab.tsx',
    'src/ui/tabs/AnalyticsTab.tsx',
    'src/ui/tabs/DiagnosticsTab.tsx',
    'src/ui/components/operation-cards.tsx',
    'src/ui/services/runtime-client.ts',
    'src/ui/types/navigation.ts',
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, `missing ${file}`);

  const main = read('src/ui/main.tsx');
  assert.match(main, /from '\.\/tabs\/OperationTab'/);
  assert.match(main, /from '\.\/tabs\/StartupTestsTab'/);
  assert.match(main, /from '\.\/services\/runtime-client'/);
  assert.doesNotMatch(main, /import\(['"]|React\.lazy|lazy\(/);
});

test('extracted tabs preserve the runtime actions and read-only startup safety', () => {
  const operation = read('src/ui/tabs/OperationTab.tsx');
  const app = read('src/ui/main.tsx');
  const tests = read('src/ui/tabs/StartupTestsTab.tsx');
  assert.match(operation, /type: 'PAUSE'/);
  assert.match(operation, /type: 'RESUME'/);
  assert.match(app, /type: 'STOP'/);
  assert.match(app, /type: reschedule \? 'RESCHEDULE' : 'SCHEDULE'/);
  assert.match(tests, /PreflightCard/);
  assert.match(tests, /DryRunCard/);
  assert.match(tests, /runDryRunQueue/);
  assert.match(read('src/ui/tabs/AnalyticsTab.tsx'), /export function AnalyticsTab/);
  assert.match(read('src/ui/tabs/DiagnosticsTab.tsx'), /export function DiagnosticsTab/);
});

test('runtime client remains the single Side Panel message bridge', () => {
  const client = read('src/ui/services/runtime-client.ts');
  assert.match(client, /chrome\.runtime\.sendMessage/);
});

test('bilingual i18n persists a language preference and synchronizes document direction', () => {
  const i18n = read('src/i18n/index.ts');
  assert.match(i18n, /UI_PREFERENCES_KEY/);
  assert.match(i18n, /chrome\?\.storage\?\.local/);
  assert.match(i18n, /document\.documentElement\.dir/);
  assert.match(i18n, /resolveLocale/);
});
