import test from 'node:test';
import assert from 'node:assert/strict';
import { getTweetPreview } from '../src/extraction/tweet-preview.ts';

test('decodes the tweet text parameter into a concise preview', () => {
  const url = 'https://twitter.com/intent/tweet?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%20%D8%A8%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85';
  assert.equal(getTweetPreview(url), 'مرحبا بالعالم');
});

test('falls back to the bank label when an intent URL has no text', () => {
  assert.equal(getTweetPreview('https://x.com/intent/post', 'التغريدة رقم 25'), 'التغريدة رقم 25');
});

test('truncates Unicode text without splitting surrogate pairs', () => {
  const preview = getTweetPreview('https://x.com/intent/post?text=%F0%9F%9A%80%F0%9F%9A%80%F0%9F%9A%80%F0%9F%9A%80', undefined, 3);
  assert.equal(preview, '🚀🚀…');
});
