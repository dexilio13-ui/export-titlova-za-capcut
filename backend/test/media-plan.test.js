'use strict';

/**
 * Tests for the media policy: the transcription API only needs audio, so we
 * prefer extracting it whenever ffmpeg is available.
 */

const test = require('node:test');
const assert = require('node:assert');
const { getLimits, planMedia, boolEnv } = require('../utils/limits');

const LIMITS_FFMPEG = { maxFileSizeMB: 25, maxUploadMB: 500, alwaysExtract: true };
const LIMITS_DIRECT = { maxFileSizeMB: 25, maxUploadMB: 500, alwaysExtract: false };
const NO_FFMPEG = { maxFileSizeMB: 25, maxUploadMB: 25, alwaysExtract: true };

test('alwaysExtract defaults to true — audio only is the default path', () => {
  assert.strictEqual(getLimits({}).alwaysExtract, true);
});

test('ALWAYS_EXTRACT_AUDIO can be turned off (or back on)', () => {
  assert.strictEqual(boolEnv({ X: 'false' }, 'X', true), false);
  assert.strictEqual(boolEnv({ X: '0' }, 'X', true), false);
  assert.strictEqual(boolEnv({ X: 'yes' }, 'X', false), true);
  assert.strictEqual(boolEnv({}, 'X', true), true, 'prazno ostaje podrazumevano');
});

test('with ffmpeg, a small H.264 MP4 still gets its audio extracted', () => {
  const plan = planMedia({
    extension: '.mp4',
    sizeBytes: 5 * 1024 * 1024,
    limits: LIMITS_FFMPEG,
    canExtract: true,
  });
  assert.strictEqual(plan.action, 'extract');
  assert.strictEqual(plan.reason, 'always_extract');
});

test('with extraction disabled, only containers the API dislikes are converted', () => {
  const small = planMedia({
    extension: '.mp4',
    sizeBytes: 5 * 1024 * 1024,
    limits: LIMITS_DIRECT,
    canExtract: true,
  });
  assert.strictEqual(small.action, 'accept');

  const exotic = planMedia({
    extension: '.mp4',
    sizeBytes: 5 * 1024 * 1024,
    limits: LIMITS_DIRECT,
    canExtract: true,
    videoNeedsStrip: true,
  });
  assert.strictEqual(exotic.action, 'extract');
  assert.strictEqual(exotic.reason, 'video_codec');

  const mov = planMedia({ extension: '.mov', sizeBytes: 5 * 1024 * 1024, limits: LIMITS_DIRECT, canExtract: true });
  assert.strictEqual(mov.action, 'extract');
});

test('without ffmpeg we forward what the API accepts and refuse the rest', () => {
  assert.strictEqual(
    planMedia({ extension: '.mp4', sizeBytes: 5 * 1024 * 1024, limits: NO_FFMPEG, canExtract: false }).action,
    'accept'
  );
  assert.deepStrictEqual(
    planMedia({ extension: '.mov', sizeBytes: 5 * 1024 * 1024, limits: NO_FFMPEG, canExtract: false }),
    { action: 'reject', reason: 'mov' }
  );
  assert.deepStrictEqual(
    planMedia({ extension: '.mp4', sizeBytes: 60 * 1024 * 1024, limits: NO_FFMPEG, canExtract: false }),
    { action: 'reject', reason: 'too_large' }
  );
});

test('oversized uploads are converted with ffmpeg instead of refused', () => {
  const plan = planMedia({
    extension: '.mp4',
    sizeBytes: 300 * 1024 * 1024,
    limits: LIMITS_FFMPEG,
    canExtract: true,
  });
  assert.strictEqual(plan.action, 'extract');
});
