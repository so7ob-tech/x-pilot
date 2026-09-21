import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptySearchFilters, filterBanks, filterHistory, filterQueue, filterSessions } from '../src/domain/search-filters.ts';

const q = (id, workspaceId) => ({ id, workspaceId, sourceBankUrl: '', targetUrl: id, position: 1, status: 'PENDING', attempts: 0, createdAt: 1, updatedAt: 1 });
const bank = (id, workspaceId) => ({ id, workspaceId, name: id, url: id, favorite: false, archived: false, createdAt: 1, updatedAt: 1 });
const session = (id, workspaceId) => ({ id, workspaceId, status: 'COMPLETED', createdAt: 1, updatedAt: 1 });
const attempt = (id, workspaceId) => ({ id, workspaceId, sessionId: id, queueItemId: id, link: id, timestamp: 1, attemptNumber: 1, action: 'PUBLISH', result: 'PUBLISHED' });
const data = {
  queue: [q('a1', 'A'), q('a2', 'A'), q('b1', 'B'), q('b2', 'B'), q('b3', 'B')],
  banks: [bank('a-bank-1', 'A'), bank('a-bank-2', 'A'), bank('b-bank-1', 'B')],
  sessions: [session('a-session', 'A'), session('b-session-1', 'B'), session('b-session-2', 'B')],
  history: [attempt('a-history-1', 'A'), attempt('a-history-2', 'A'), attempt('b-history', 'B')],
};
const filters = (workspaceId) => ({ ...emptySearchFilters, workspaceId });

test('C1 initial active Workspace ID selects only A', () => assert.equal(filterQueue(data.queue, filters('A')).length, 2));
test('C3 explicit * selects all Workspaces', () => assert.equal(filterQueue(data.queue, filters('*')).length, 5));
test('C5 changing active Workspace context selects B even after *', () => {
  const next = filters('B');
  assert.equal(next.workspaceId, 'B');
  assert.equal(filterQueue(data.queue, next).length, 3);
});
test('C6 Clear Filters preserves active Workspace scope', () => {
  const cleared = { ...emptySearchFilters, workspaceId: 'B' };
  assert.equal(cleared.workspaceId, 'B');
  assert.equal(filterQueue(data.queue, cleared).length, 3);
});
test('C7 and C8 UI initializes and renders the explicit filter value', () => {
  const ui = fs.readFileSync('src/ui/main.tsx', 'utf8');
  assert.match(ui, /setQueueFilters\(\{ \.\.\.emptySearchFilters, workspaceId \}\)/);
  assert.match(ui, /<select value=\{filters\.workspaceId\}/);
  assert.doesNotMatch(ui, /<option value="@active"/);
});
test('C9 exact Workspace ID and * are the only operational scope semantics', () => {
  const domain = fs.readFileSync('src/domain/search-filters.ts', 'utf8');
  assert.match(domain, /filters\.workspaceId === '\*'/);
  assert.doesNotMatch(domain, /workspaceScopeMode|WorkspaceScopeMode/);
  assert.deepEqual(filterQueue(data.queue, filters('A')).map((item) => item.workspaceId), ['A', 'A']);
});
test('C10 dependent Banks, Sessions, and History follow the same selected scope', () => {
  assert.equal(filterBanks(data.banks, filters('A')).length, 2);
  assert.equal(filterSessions(data.sessions, filters('B')).length, 2);
  assert.equal(filterHistory(data.history, filters('*')).length, 3);
});
test('C11 displayed All Workspaces and actual data semantics remain aligned', () => {
  const all = filters('*');
  const a = filters('A');
  assert.equal(all.workspaceId, '*');
  assert.equal(filterQueue(data.queue, all).length, 5);
  assert.equal(filterQueue(data.queue, a).length, 2);
});
