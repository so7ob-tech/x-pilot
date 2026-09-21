import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySearchFilters, filterBanks, filterHistory, filterQueue, filterSessions } from '../src/domain/search-filters.ts';

const filters = (patch = {}) => ({ ...emptySearchFilters, ...patch });
const queue = [
  { id: 'q1', workspaceId: 'w1', sourceBankId: 'b1', sourceBankUrl: 'https://bank/one', targetUrl: 'https://x.test/1', label: 'Morning launch', position: 1, status: 'PENDING', attempts: 0, createdAt: 1000, updatedAt: 1000 },
  { id: 'q2', workspaceId: 'w2', sourceBankId: 'b2', sourceBankUrl: 'https://bank/two', targetUrl: 'https://x.test/2', label: 'Evening launch', position: 2, status: 'PUBLISHED', attempts: 1, createdAt: 2000, updatedAt: 2000 },
];
const banks = [
  { id: 'b1', workspaceId: 'w1', name: 'Morning Bank', description: 'first', url: 'https://bank/one', updatedAt: 1000 },
  { id: 'b2', workspaceId: 'w2', name: 'Evening Bank', description: 'second', url: 'https://bank/two', updatedAt: 2000 },
];

test('filters Queue by query, status, bank, and Workspace without mutating input', () => {
  const snapshot = structuredClone(queue);
  assert.deepEqual(filterQueue(queue, filters({ query: 'morning', status: 'PENDING', bankId: 'b1', workspaceId: 'w1' }), banks).map((item) => item.id), ['q1']);
  assert.deepEqual(queue, snapshot);
  assert.deepEqual(filterQueue(queue, filters({ workspaceId: '*' }), banks).map((item) => item.id), ['q1', 'q2']);
});

test('filters Banks by name and date', () => {
  assert.deepEqual(filterBanks(banks, filters({ query: 'evening', dateFrom: '1970-01-02', dateTo: '1970-01-02' })).map((bank) => bank.id), []);
  assert.deepEqual(filterBanks(banks, filters({ query: 'evening' })).map((bank) => bank.id), ['b2']);
});

test('filters Sessions and History by status and Session id', () => {
  const sessions = [{ id: 's1', workspaceId: 'w1', status: 'COMPLETED', startedAt: 1000, updatedAt: 1000, createdAt: 1000 }, { id: 's2', workspaceId: 'w1', status: 'FAILED', startedAt: 2000, updatedAt: 2000, createdAt: 2000 }];
  const history = [{ id: 'h1', workspaceId: 'w1', sessionId: 's1', queueItemId: 'q1', link: 'x', timestamp: 1000, action: 'PUBLISH', result: 'PUBLISHED' }, { id: 'h2', workspaceId: 'w1', sessionId: 's2', queueItemId: 'q2', link: 'x', timestamp: 2000, action: 'PUBLISH', result: 'FAILED' }];
  assert.deepEqual(filterSessions(sessions, filters({ status: 'FAILED' })).map((session) => session.id), ['s2']);
  assert.deepEqual(filterHistory(history, filters({ sessionId: 's2', status: 'FAILED' })).map((attempt) => attempt.id), ['h2']);
});
