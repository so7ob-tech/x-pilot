import test from 'node:test';
import assert from 'node:assert/strict';
import { getPageCount, pageRange, paginate } from '../src/domain/pagination.ts';

const items = Array.from({ length: 105 }, (_, index) => index + 1);

test('supports 10, 50, 100, and all Queue page sizes', () => {
  assert.equal(getPageCount(items.length, 10), 11);
  assert.equal(getPageCount(items.length, 50), 3);
  assert.equal(getPageCount(items.length, 100), 2);
  assert.equal(getPageCount(items.length, 'ALL'), 1);
  assert.deepEqual(paginate(items, 2, 10), Array.from({ length: 10 }, (_, index) => index + 11));
  assert.equal(paginate(items, 1, 'ALL').length, 105);
});

test('clamps page ranges at the final page and handles empty results', () => {
  assert.deepEqual(pageRange(105, 3, 50), { from: 101, to: 105 });
  assert.deepEqual(pageRange(0, 1, 10), { from: 0, to: 0 });
  assert.equal(getPageCount(0, 10), 1);
});

test('pagination does not mutate the filtered Queue array', () => {
  const snapshot = [...items];
  paginate(items, 2, 50);
  assert.deepEqual(items, snapshot);
});
