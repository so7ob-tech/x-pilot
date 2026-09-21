import test from 'node:test';
import assert from 'node:assert/strict';
import { getUserFacingMessage, toUserFacingMessage } from '../src/ui/services/error-messages.ts';

test('translates the daily-limit code to Arabic', () => {
  assert.equal(getUserFacingMessage('X_DAILY_POST_LIMIT_REACHED'), 'لقد وصلت إلى الحد الأقصى لعدد المنشورات اليومية');
  assert.equal(toUserFacingMessage('فشل: X_DAILY_POST_LIMIT_REACHED'), 'فشل: لقد وصلت إلى الحد الأقصى لعدد المنشورات اليومية');
});

test('keeps unrelated messages unchanged', () => {
  assert.equal(getUserFacingMessage('PUBLISH_CONTROLS_NOT_READY'), 'PUBLISH_CONTROLS_NOT_READY');
  assert.equal(toUserFacingMessage(undefined), undefined);
});
