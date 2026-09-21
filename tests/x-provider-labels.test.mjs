import test from 'node:test';
import assert from 'node:assert/strict';
import { isDailyPostLimitMessage, isPublishButtonLabel, normalizeControlLabel } from '../src/content/providers/x-provider-adapter.ts';

test('recognizes Arabic and English publish labels', () => {
  assert.equal(isPublishButtonLabel('نشر'), true);
  assert.equal(isPublishButtonLabel('Post'), true);
  assert.equal(isPublishButtonLabel('Tweet'), true);
  assert.equal(isPublishButtonLabel('نَشْر'), true);
  assert.equal(isPublishButtonLabel(' نشر  المنشور '), true);
  assert.equal(isPublishButtonLabel('إرسال'), true);
});

test('does not treat add-post and reply controls as publish buttons', () => {
  assert.equal(isPublishButtonLabel('إضافة منشور'), false);
  assert.equal(isPublishButtonLabel('نشر الكل'), false);
  assert.equal(isPublishButtonLabel('يمكن للجميع الرد'), false);
});

test('normalizes Arabic tatweel, diacritics, and whitespace', () => {
  assert.equal(normalizeControlLabel(' نَـشْر '), 'نشر');
  assert.equal(normalizeControlLabel('  نشر   المنشور  '), 'نشر المنشور');
});

test('recognizes X daily post limit messages without treating them as publish failures', () => {
  assert.equal(isDailyPostLimitMessage('لقد وصلت إلى الحد الأقصى لعدد المنشورات اليومية. اشترك في Premium للحصول على حدود أعلى.'), true);
  assert.equal(isDailyPostLimitMessage("You've reached the daily post limit. Subscribe to Premium for higher limits."), true);
  assert.equal(isDailyPostLimitMessage('Composer is ready and Post is enabled'), false);
});
