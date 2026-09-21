import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBulkStatus, reorderSelected } from '../src/domain/bulk-queue.ts';

const items = [
  { id: 'a', position: 1, status: 'PENDING', attempts: 0, updatedAt: 1 },
  { id: 'b', position: 2, status: 'FAILED', attempts: 2, lastError: 'x', updatedAt: 1 },
  { id: 'c', position: 3, status: 'PENDING', attempts: 1, updatedAt: 1 },
];

test('bulk status actions reset selected items without changing unselected items', () => {
  const next = applyBulkStatus(items, ['b'], 'RETRY');
  assert.equal(next[1].status, 'PENDING');
  assert.equal(next[1].attempts, 0);
  assert.equal(next[1].lastError, undefined);
  assert.equal(next[0].status, 'PENDING');
  assert.equal(next[2].attempts, 1);
});

test('bulk reorder moves selected items as a stable group', () => {
  assert.deepEqual(reorderSelected(items, ['b', 'c'], 'TOP').map((item) => item.id), ['b', 'c', 'a']);
  assert.deepEqual(reorderSelected(items, ['a', 'c'], 'BOTTOM').map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(reorderSelected(items, ['b', 'c'], 'TOP').map((item) => item.position), [1, 2, 3]);
});
