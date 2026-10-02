'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeGroq } = require('../services/groq');

test('normalizes a full Groq verbose_json payload', () => {
  const raw = {
    text: 'Danas ćemo pričati.',
    language: 'sr',
    segments: [
      { id: 0, start: 0, end: 2.4, text: ' Danas ćemo pričati.' },
      { id: 1, start: 2.4, end: 5.1, text: ' Ovo je jednostavan primer.' },
    ],
    words: [
      { word: 'Danas', start: 0, end: 0.42 },
      { word: 'ćemo', start: 0.5, end: 0.8 },
    ],
  };
  const out = normalizeGroq(raw);
  assert.strictEqual(out.language, 'sr');
  assert.strictEqual(out.segments.length, 2);
  assert.strictEqual(out.segments[0].text, 'Danas ćemo pričati.');
  assert.strictEqual(out.segments[0].id, 1);
  assert.strictEqual(out.segments[1].id, 2);
  assert.strictEqual(out.words.length, 2);
  assert.deepStrictEqual(out.words[0], { word: 'Danas', start: 0, end: 0.42 });
});

test('falls back gracefully when word timestamps are missing', () => {
  const out = normalizeGroq({ language: 'sr', segments: [{ start: 0, end: 1, text: 'Zdravo' }] });
  assert.deepStrictEqual(out.words, []);
  assert.strictEqual(out.segments.length, 1);
});

test('drops malformed segments instead of inventing timestamps', () => {
  const out = normalizeGroq({
    segments: [
      { start: 'x', end: 2, text: 'bad start' },
      { start: 0, end: NaN, text: 'bad end' },
      { start: 0, end: 1, text: '' },
      { start: 3, end: 4, text: 'good' },
    ],
  });
  assert.strictEqual(out.segments.length, 1);
  assert.strictEqual(out.segments[0].text, 'good');
});

test('handles empty/null payloads', () => {
  assert.deepStrictEqual(normalizeGroq(null), { language: 'auto', segments: [], words: [] });
  assert.deepStrictEqual(normalizeGroq({}), { language: 'auto', segments: [], words: [] });
});
