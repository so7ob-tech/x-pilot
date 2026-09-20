import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinksFromMarkup, extractLinksFromValues } from '../src/extraction/bank-parser.ts';

test('extracts encoded twitter intent links from raw Google Sites markup', () => {
  const markup = '<a href="https://twitter.com/intent/tweet?text=hello&amp;url=https%3A%2F%2Fpic.twitter.com%2Fab12">Tweet</a>';
  const result = extractLinksFromMarkup(markup);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].url, 'https://twitter.com/intent/tweet?text=hello&url=https%3A%2F%2Fpic.twitter.com%2Fab12');
});

test('preserves first occurrence and counts duplicate tweet links', () => {
  const link = 'https://x.com/intent/post?text=hello';
  const result = extractLinksFromValues([{ raw: link, label: 'first' }, { raw: link, label: 'second' }]);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].label, 'first');
  assert.equal(result.duplicateCount, 1);
});

test('ignores unrelated page links without inflating invalid candidates', () => {
  const result = extractLinksFromValues([{ raw: 'https://example.com/about' }, { raw: 'not-a-url' }]);
  assert.equal(result.links.length, 0);
  assert.equal(result.invalidCount, 0);
});
