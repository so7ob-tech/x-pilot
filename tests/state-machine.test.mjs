import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextPendingItem } from '../src/domain/state-machine.ts';

const item = (id, position, status) => ({ id, position, status, sourceBankUrl: 'https://bank.example', targetUrl: `https://x.com/intent/post?text=${id}`, attempts: 0, createdAt: 1, updatedAt: 1 });

test('selects the next pending item after an exhausted failure', () => {
  const queue = [item('failed', 1, 'FAILED'), item('next', 2, 'PENDING'), item('later', 3, 'PENDING')];
  assert.equal(getNextPendingItem(queue, 'failed')?.id, 'next');
});

test('does not select terminal or failed items as the next item', () => {
  const queue = [item('failed', 1, 'FAILED'), item('published', 2, 'PUBLISHED'), item('skipped', 3, 'SKIPPED')];
  assert.equal(getNextPendingItem(queue, 'failed'), undefined);
});
