import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';
import { translateForLocale } from '../src/i18n/translate.ts';
import { runPreflight } from '../src/domain/preflight.ts';

function flatten(value, prefix = '', output = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, output);
  } else output.set(prefix, value);
  return output;
}

test('Arabic and English dictionaries expose identical translation key sets', () => {
  const arabic = flatten(ar);
  const english = flatten(en);
  assert.deepEqual([...arabic.keys()].sort(), [...english.keys()].sort());
  for (const key of arabic.keys()) assert.notEqual(arabic.get(key), undefined, `Arabic key missing: ${key}`);
  for (const key of english.keys()) assert.notEqual(english.get(key), undefined, `English key missing: ${key}`);
});

test('Chrome manifest metadata is localized through both locale bundles', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  assert.match(manifest.name, /^__MSG_/);
  assert.match(manifest.description, /^__MSG_/);
  assert.ok(fs.existsSync(new URL('../public/_locales/en/messages.json', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../public/_locales/ar/messages.json', import.meta.url)));
});

test('Preflight domain output is language-neutral and renderable in both locales', () => {
  const result = runPreflight({ workspace: null, queue: [], banks: [], alarmsAvailable: true, permissionsGranted: true, settings: { intervalMinutes: 1, maxRetries: 1, failureBehavior: 'CONTINUE', duplicatePolicy: 'BLOCK' }, xInspection: null });
  assert.equal(typeof result.summaryKey, 'string');
  assert.equal(typeof result.summaryParams, 'object');
  for (const check of result.checks) {
    assert.equal(typeof check.messageKey, 'string');
    assert.equal(typeof check.status, 'string');
  }
});

test('reported Queue, session, history, analytics, workspace, and settings labels resolve in both locales', () => {
  const keys = [
    'ui.remaining', 'banks.hint', 'sessions.eyebrow', 'sessions.count', 'sessions.noMatch',
    'history.eyebrow', 'history.count', 'history.noMatch', 'analytics.eyebrow',
    'analytics.derivedHint', 'analytics.totalWorkspaces', 'analytics.totalPublished',
    'analytics.totalFailures', 'analytics.sessionsOverTime', 'analytics.workspaceComparison',
    'analytics.noSessions', 'workspaces.activeSummary', 'settings.badge', 'backup.hint',
  ];
  for (const locale of ['ar', 'en']) {
    for (const key of keys) {
      const value = translateForLocale(locale, key, { visible: 0, total: 0, name: 'Test' });
      assert.notEqual(value, key, `${locale} has no translation for ${key}`);
    }
  }
});
