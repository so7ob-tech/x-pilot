import test from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight } from '../src/domain/preflight.ts';

const workspace = { id: 'ws-1', name: 'Campaign', description: '', favorite: false, archived: false, createdAt: 1, updatedAt: 1, lastActivityAt: 1 };
const bank = { id: 'bank-1', workspaceId: 'ws-1', name: 'Bank', url: 'https://example.com/bank', favorite: false, archived: false, createdAt: 1, updatedAt: 1 };
const settings = { intervalMinutes: 2, maxRetries: 2, failureBehavior: 'CONTINUE', confirmBeforeStart: true, keepAutomationTabOpen: true, closeTabOnComplete: false, duplicatePolicy: 'BLOCK' };
const inspection = { pageKind: 'X', composerFound: true, contentPresent: true, postButtonFound: true, postButtonEnabled: true };
const item = (overrides = {}) => ({ id: crypto.randomUUID(), workspaceId: 'ws-1', sourceBankId: 'bank-1', sourceBankUrl: bank.url, targetUrl: 'https://x.com/intent/post?text=hello', position: 1, status: 'PENDING', attempts: 0, createdAt: 1, updatedAt: 1, ...overrides });

function base(queue = [item()], overrides = {}) { return { workspace, queue, banks: [bank], alarmsAvailable: true, permissionsGranted: true, settings, xInspection: inspection, ...overrides }; }

test('passes a fully ready Queue and reports counts', () => {
  const result = runPreflight(base());
  assert.equal(result.ready, true);
  assert.equal(result.counts.ready, 1);
  assert.equal(result.summaryKey, 'preflight.ready');
  assert.deepEqual(result.summaryParams, { ready: 1, total: 1 });
});

test('blocks an empty Queue and invalid retry configuration', () => {
  const result = runPreflight(base([], { settings: { ...settings, maxRetries: 11 } }));
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((check) => check.id === 'queue-not-empty').status, 'FAIL');
  assert.equal(result.checks.find((check) => check.id === 'retry-config').blocking, true);
});

test('blocks a published duplicate under BLOCK policy', () => {
  const result = runPreflight(base([item({ duplicateStatus: 'PUBLISHED_DUPLICATE' })]));
  assert.equal(result.ready, false);
  assert.equal(result.counts.publishedDuplicates, 1);
  assert.equal(result.checks.find((check) => check.id === 'duplicates').status, 'FAIL');
});

test('warns when X has not been inspected but keeps static checks useful', () => {
  const result = runPreflight(base([item()], { xInspection: null }));
  assert.equal(result.ready, true);
  assert.equal(result.checks.find((check) => check.id === 'x-adapter').status, 'WARN');
});

test('blocks login and automation-owner conflicts', () => {
  const result = runPreflight(base([item()], { automationWorkspaceId: 'other', xInspection: { ...inspection, pageKind: 'LOGIN' } }));
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((check) => check.id === 'automation-owner').status, 'FAIL');
  assert.equal(result.checks.find((check) => check.id === 'x-adapter').status, 'FAIL');
});

test('warn policy reports queued duplicates without auto-blocking', () => {
  const result = runPreflight(base([item({ duplicateStatus: 'DUPLICATE' })], { settings: { ...settings, duplicatePolicy: 'WARN' } }));
  assert.equal(result.ready, true);
  assert.equal(result.counts.duplicates, 1);
  assert.equal(result.checks.find((check) => check.id === 'duplicates').status, 'WARN');
});
