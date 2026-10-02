'use strict';

/**
 * Tests for the audio extraction strategy: we only skip re-encoding when the
 * source audio is already a compact codec that the transcription API accepts.
 */

const test = require('node:test');
const assert = require('node:assert');
const { chooseStrategy } = require('../services/audio');

test('copies compact audio codecs instead of re-encoding', () => {
  for (const codec of ['aac', 'mp3', 'opus', 'vorbis', 'alac']) {
    assert.strictEqual(chooseStrategy({ codecName: codec }), 'copy', codec);
  }
});

test('re-encodes everything else', () => {
  for (const codec of ['pcm_s16le', 'flac', 'pcm_mulaw', 'alaw', 'wavpack']) {
    assert.strictEqual(chooseStrategy({ codecName: codec }), 'encode', codec);
  }
});

test('encodes when ffprobe could not identify the stream', () => {
  assert.strictEqual(chooseStrategy(null), 'encode');
  assert.strictEqual(chooseStrategy({ codecName: 'unknown' }), 'encode');
  assert.strictEqual(chooseStrategy({ codecName: '' }), 'encode');
});

test('strategy is case insensitive', () => {
  assert.strictEqual(chooseStrategy({ codecName: 'AAC' }), 'copy');
});