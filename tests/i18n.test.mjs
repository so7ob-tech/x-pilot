import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale, translate } from '../src/i18n/index.ts';

test('AUTO follows Arabic and English browser locales', () => {
  assert.equal(resolveLocale('AUTO', 'ar-YE'), 'ar');
  assert.equal(resolveLocale('AUTO', 'en-US'), 'en');
  assert.equal(resolveLocale('AR', 'en-US'), 'ar');
  assert.equal(resolveLocale('EN', 'ar-YE'), 'en');
});

test('translation dictionary exposes the daily-limit message in both languages', () => {
  assert.equal(translate('errors.dailyPostLimitReached'), 'You have reached the daily post limit');
});
