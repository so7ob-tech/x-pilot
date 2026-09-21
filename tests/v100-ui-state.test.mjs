import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySearchFilters, filterBanks, filterHistory, filterQueue, filterSessions } from '../src/domain/search-filters.ts';
import { createWorkspaceStateCache, isNewerRequest, reconcileWorkspaceState, removeWorkspaceState, setActiveWorkspaceInCache } from '../src/ui/state/workspace-state-store.ts';

const workspace = (id, archived = false) => ({ id, name: id, description: '', favorite: false, archived, createdAt: 1, updatedAt: 1, lastActivityAt: 1 });
const state = (id, queue = [], banks = [], sessions = [], history = []) => ({ workspaceId: id, workspace: workspace(id), queue, banks, historicalSessions: sessions, history });
const q = (id, workspaceId) => ({ id, workspaceId, sourceBankUrl: '', targetUrl: `https://x.test/${id}`, position: 1, status: 'PENDING', attempts: 0, createdAt: 1, updatedAt: 1 });
const b = (id, workspaceId) => ({ id, workspaceId, name: id, url: `https://bank/${id}`, favorite: false, archived: false, createdAt: 1, updatedAt: 1 });

function scoped(mode, workspaceId = '') { return { ...emptySearchFilters, workspaceScopeMode: mode, workspaceId }; }

test('v1.0 Workspace scope defaults to Active and follows Active changes', () => {
  const items = [q('a1', 'A'), q('b1', 'B')];
  assert.deepEqual(filterQueue(items, scoped('ACTIVE'), [], 'A').map((item) => item.id), ['a1']);
  assert.deepEqual(filterQueue(items, scoped('ACTIVE'), [], 'B').map((item) => item.id), ['b1']);
});

test('v1.0 ALL scope includes every non-archived Workspace dataset', () => {
  const filters = scoped('ALL', '*');
  assert.equal(filterQueue([q('a', 'A'), q('b', 'B')], filters, [], 'A').length, 2);
  assert.equal(filterBanks([b('a', 'A'), b('b', 'B')], filters, 'A').length, 2);
});

test('v1.0 SPECIFIC scope remains pinned when Active Workspace changes', () => {
  const filters = scoped('SPECIFIC', 'B');
  assert.deepEqual(filterQueue([q('a', 'A'), q('b', 'B')], filters, [], 'A').map((item) => item.id), ['b']);
});

test('v1.0 dependent session and history filters respect Workspace scope', () => {
  const filters = scoped('ACTIVE');
  const sessions = [{ id: 'sa', workspaceId: 'A', status: 'COMPLETED', createdAt: 1, updatedAt: 1 }, { id: 'sb', workspaceId: 'B', status: 'COMPLETED', createdAt: 1, updatedAt: 1 }];
  const history = [{ id: 'ha', workspaceId: 'A', sessionId: 'sa', queueItemId: 'a', link: '', timestamp: 1, attemptNumber: 1, action: 'PUBLISH', result: 'PUBLISHED' }, { id: 'hb', workspaceId: 'B', sessionId: 'sb', queueItemId: 'b', link: '', timestamp: 1, attemptNumber: 1, action: 'PUBLISH', result: 'PUBLISHED' }];
  assert.deepEqual(filterSessions(sessions, filters, 'A').map((item) => item.id), ['sa']);
  assert.deepEqual(filterHistory(history, filters, 'A').map((item) => item.id), ['ha']);
});

test('v1.0 cache reconciles mutation state immediately and rejects stale revisions', () => {
  let cache = createWorkspaceStateCache([state('A'), state('B')], { activeWorkspaceId: 'A' });
  cache = reconcileWorkspaceState(cache, state('A', [q('new', 'A')]), 2);
  assert.equal(cache.byId.A.queue[0].id, 'new');
  const stale = reconcileWorkspaceState(cache, state('A'), 1);
  assert.equal(stale.byId.A.queue[0].id, 'new');
  cache = setActiveWorkspaceInCache(cache, 'B');
  cache = removeWorkspaceState(cache, 'A');
  assert.equal(cache.byId.A, undefined);
  assert.equal(cache.activeWorkspaceId, 'B');
  assert.equal(isNewerRequest(4, 3), true);
  assert.equal(isNewerRequest(2, 3), false);
});
