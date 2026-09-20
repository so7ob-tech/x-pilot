import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublishButtonLabel } from '../src/content/providers/x-provider-adapter.ts';

test('recognizes Arabic and English publish labels', () => {
  assert.equal(isPublishButtonLabel('نشر'), true);
  assert.equal(isPublishButtonLabel('Post'), true);
  assert.equal(isPublishButtonLabel('Tweet'), true);
});

test('does not treat add-post and reply controls as publish buttons', () => {
  assert.equal(isPublishButtonLabel('إضافة منشور'), false);
  assert.equal(isPublishButtonLabel('نشر الكل'), false);
  assert.equal(isPublishButtonLabel('يمكن للجميع الرد'), false);
});
