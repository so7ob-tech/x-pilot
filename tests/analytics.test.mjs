import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGlobalAnalytics, calculateWorkspaceAnalytics } from '../src/domain/analytics.ts';

const makeState = (id, archived = false) => ({
  workspaceId: id,
  workspace: { id, name: `Workspace ${id}`, archived, lastActivityAt: 5000 },
  banks: [{ id: `${id}-bank`, name: 'Main Bank' }],
  queue: [],
  session: null,
  historicalSessions: [{ id: `${id}-session`, workspaceId: id, bankId: `${id}-bank`, startedAt: 1000, completedAt: 61000, updatedAt: 61000, status: 'COMPLETED', totalItems: 3, publishedCount: 2, failedCount: 1, skippedCount: 0 }],
  history: [
    { id: `${id}-a1`, workspaceId: id, sessionId: `${id}-session`, queueItemId: 'item-1', timestamp: 2000, attemptNumber: 1, action: 'PUBLISH', result: 'PUBLISHED' },
    { id: `${id}-a2`, workspaceId: id, sessionId: `${id}-session`, queueItemId: 'item-2', timestamp: 3000, attemptNumber: 2, action: 'PUBLISH', result: 'FAILED' },
  ],
});

test('calculates Workspace KPIs from sessions and history without stored analytics', () => {
  const result = calculateWorkspaceAnalytics(makeState('w1'));
  assert.equal(result.totalSessions, 1);
  assert.equal(result.totalPosts, 3);
  assert.equal(result.published, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.successRate, 66.67);
  assert.equal(result.averageAttempts, 1.5);
  assert.equal(result.averageSessionDurationMs, 60000);
  assert.equal(result.mostActiveBank.name, 'Main Bank');
  assert.equal(result.lastActivityAt, 61000);
});

test('aggregates global KPIs and Sessions over time while excluding archived Workspaces', () => {
  const result = calculateGlobalAnalytics([makeState('w1'), makeState('w2', true)]);
  assert.equal(result.totalWorkspaces, 1);
  assert.equal(result.totalPublished, 2);
  assert.equal(result.totalFailures, 1);
  assert.deepEqual(result.sessionsOverTime, [{ date: '1970-01-01', sessions: 1 }]);
});
