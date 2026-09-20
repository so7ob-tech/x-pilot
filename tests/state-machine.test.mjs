import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextPendingItem, nextSessionStatus } from '../src/domain/state-machine.ts';

const item = (id, position, status) => ({ id, position, status, sourceBankUrl: 'https://bank.example', targetUrl: `https://x.com/intent/post?text=${id}`, attempts: 0, createdAt: 1, updatedAt: 1 });

test('selects the next pending item after an exhausted failure', () => {
  const queue = [item('failed', 1, 'FAILED'), item('next', 2, 'PENDING'), item('later', 3, 'PENDING')];
  assert.equal(getNextPendingItem(queue, 'failed')?.id, 'next');
});

test('does not select terminal or failed items as the next item', () => {
  const queue = [item('failed', 1, 'FAILED'), item('published', 2, 'PUBLISHED'), item('skipped', 3, 'SKIPPED')];
  assert.equal(getNextPendingItem(queue, 'failed'), undefined);
});

test('maps Pause and Resume to persisted session states', () => {
  assert.equal(nextSessionStatus('RUNNING', 'PAUSE'), 'PAUSED');
  assert.equal(nextSessionStatus('PAUSED', 'RESUME'), 'RUNNING');
  assert.equal(nextSessionStatus('WAITING', 'PAUSE'), 'PAUSED');
});

test('Stop remains distinct from Pause and Resume', () => {
  assert.equal(nextSessionStatus('RUNNING', 'STOP'), 'STOPPED');
  assert.equal(nextSessionStatus('PAUSED', 'STOP'), 'STOPPED');
  assert.equal(nextSessionStatus('STOPPED', 'RESUME'), 'RUNNING');
});
