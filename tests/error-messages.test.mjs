import test from 'node:test';
import assert from 'node:assert/strict';
import { getUserFacingMessage, toUserFacingMessage } from '../src/ui/services/error-messages.ts';
import { setLanguagePreference } from '../src/i18n/index.ts';

test('translates the daily-limit code to the selected Arabic locale', async () => {
  await setLanguagePreference('AR');
  assert.equal(getUserFacingMessage('X_DAILY_POST_LIMIT_REACHED'), 'لقد وصلت إلى الحد الأقصى لعدد المنشورات اليومية');
  assert.equal(toUserFacingMessage('فشل: X_DAILY_POST_LIMIT_REACHED'), 'فشل: لقد وصلت إلى الحد الأقصى لعدد المنشورات اليومية');
});

test('translates known codes and preserves unrelated messages', async () => {
  await setLanguagePreference('EN');
  assert.equal(getUserFacingMessage('PUBLISH_CONTROLS_NOT_READY'), 'Publishing controls are not ready');
  assert.equal(toUserFacingMessage(undefined), undefined);
});
