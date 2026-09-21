import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextAllowedPublishingTime, isWithinPublishingWindow } from '../src/domain/scheduling.ts';

const utc = 'UTC';
const mondayMorning = Date.parse('2026-09-21T10:00:00Z');

test('allows publishing inside a weekday window and blocks outside it', () => {
  const windows = [{ id: 'morning', days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', enabled: true }];
  assert.equal(isWithinPublishingWindow(mondayMorning, utc, windows), true);
  assert.equal(isWithinPublishingWindow(Date.parse('2026-09-21T13:00:00Z'), utc, windows), false);
});

test('supports multiple windows and finds the next allowed minute', () => {
  const windows = [
    { id: 'morning', days: [1], start: '09:00', end: '12:00', enabled: true },
    { id: 'evening', days: [1], start: '18:00', end: '22:00', enabled: true },
  ];
  assert.equal(getNextAllowedPublishingTime(Date.parse('2026-09-21T13:00:00Z'), utc, windows), Date.parse('2026-09-21T18:00:00Z'));
});

test('supports overnight windows across midnight', () => {
  const windows = [{ id: 'overnight', days: [1], start: '22:00', end: '02:00', enabled: true }];
  assert.equal(isWithinPublishingWindow(Date.parse('2026-09-22T01:00:00Z'), utc, windows), true);
  assert.equal(isWithinPublishingWindow(Date.parse('2026-09-22T03:00:00Z'), utc, windows), false);
});

test('empty or disabled windows mean no publishing restriction', () => {
  assert.equal(isWithinPublishingWindow(mondayMorning, utc, []), true);
  assert.equal(getNextAllowedPublishingTime(mondayMorning, utc, []), mondayMorning);
});
