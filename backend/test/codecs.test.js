'use strict';

/**
 * Tests for codec handling: phone videos (HEVC/VP9/AV1) must be routed through
 * audio extraction instead of being forwarded to an API that cannot read them.
 */

const test = require('node:test');
const assert = require('node:assert');

const { needsVideoStrip } = require('../services/audio');
const { mapGroqError } = require('../utils/mapGroqError');

test('H.264 MP4s are forwarded untouched', () => {
  for (const codec of ['h264', 'avc1', 'mpeg4']) {
    assert.strictEqual(needsVideoStrip(codec), false, codec);
  }
});

test('phone codecs get their video track stripped', () => {
  for (const codec of ['hevc', 'h265', 'vp9', 'av1', 'prores', 'mpeg2video']) {
    assert.strictEqual(needsVideoStrip(codec), true, codec);
  }
});

test('unknown codec is left alone rather than guessed', () => {
  assert.strictEqual(needsVideoStrip(null), false);
});

test('the API rejecting a container becomes a helpful codec message', () => {
  const err = mapGroqError({
    status: 400,
    message: 'file must be one of the following types: [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]',
  });
  assert.strictEqual(err.statusCode, 415);
  assert.strictEqual(err.code, 'UNSUPPORTED_CODEC');
  assert.ok(/H\.264/.test(err.safeMessage), 'poruka mora predložiti H.264');
  assert.ok(/MOV/.test(err.safeMessage), 'poruka mora spomenuti alternativu');
});

test('other upstream failures keep their generic messages', () => {
  assert.strictEqual(mapGroqError({ status: 401 }).statusCode, 500);
  assert.strictEqual(mapGroqError({ status: 429 }).statusCode, 429);
  assert.strictEqual(mapGroqError({ status: 503 }).statusCode, 502);
  assert.strictEqual(mapGroqError({ code: 'ETIMEDOUT' }).statusCode, 504);
});

test('no mapped message ever leaks API details', () => {
  const messages = [
    mapGroqError({ status: 400, message: 'file must be one of the following types' }),
    mapGroqError({ status: 401, message: 'invalid api key gsk_secret' }),
    mapGroqError({ status: 500, message: 'upstream exploded at /app/x.js' }),
  ].map((e) => e.safeMessage);
  for (const m of messages) {
    assert.ok(!/gsk_|app\/x\.js|flac mp3/.test(m));
  }
});
