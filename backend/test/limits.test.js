'use strict';

/**
 * Tests for the upload-size policy: what we accept, what we convert,
 * and what we refuse — with and without ffmpeg.
 */

const test = require('node:test');
const assert = require('node:assert');
const { getLimits, decideMediaAction, rejectionMessage, MB } = require('../utils/limits');

test('getLimits defaults to the Groq free tier and no bigger upload', () => {
  const l = getLimits({});
  assert.strictEqual(l.maxFileSizeMB, 25);
  assert.strictEqual(l.maxUploadMB, 25);
});

test('getLimits honours MAX_UPLOAD_MB but never drops below the Groq limit', () => {
  assert.strictEqual(getLimits({ MAX_UPLOAD_MB: '500' }).maxUploadMB, 500);
  // A smaller upload cap than the Groq limit is corrected upward.
  assert.strictEqual(getLimits({ MAX_FILE_SIZE_MB: '100', MAX_UPLOAD_MB: '10' }).maxUploadMB, 100);
});

test('small MP4 is forwarded to Groq untouched', () => {
  const out = decideMediaAction({
    extension: '.mp4',
    sizeBytes: 5 * MB,
    limits: { maxFileSizeMB: 25, maxUploadMB: 500 },
    canExtract: true,
  });
  assert.deepStrictEqual(out, { action: 'accept' });
});

test('MOV and oversized MP4 are converted when ffmpeg exists', () => {
  const limits = { maxFileSizeMB: 25, maxUploadMB: 500 };
  assert.deepStrictEqual(decideMediaAction({ extension: '.mov', sizeBytes: 2 * MB, limits, canExtract: true }), {
    action: 'extract',
  });
  assert.deepStrictEqual(decideMediaAction({ extension: '.mp4', sizeBytes: 300 * MB, limits, canExtract: true }), {
    action: 'extract',
  });
});

test('MOV and oversized MP4 are refused with a clear reason without ffmpeg', () => {
  const limits = { maxFileSizeMB: 25, maxUploadMB: 25 };
  assert.deepStrictEqual(decideMediaAction({ extension: '.mov', sizeBytes: 2 * MB, limits, canExtract: false }), {
    action: 'reject',
    reason: 'mov',
  });
  assert.deepStrictEqual(decideMediaAction({ extension: '.mp4', sizeBytes: 40 * MB, limits, canExtract: false }), {
    action: 'reject',
    reason: 'too_large',
  });
});

test('the boundary exactly at the Groq limit is still accepted', () => {
  const limits = { maxFileSizeMB: 25, maxUploadMB: 500 };
  const out = decideMediaAction({ extension: '.mp4', sizeBytes: 25 * MB, limits, canExtract: false });
  assert.deepStrictEqual(out, { action: 'accept' });
});

test('rejection messages name the limit and never leak internals', () => {
  const limits = { maxFileSizeMB: 25, maxUploadMB: 25 };
  const mov = rejectionMessage('mov', limits);
  const big = rejectionMessage('too_large', limits);
  assert.ok(mov.includes('MP4'));
  assert.ok(big.includes('25 MB'));
  assert.ok(!/gsk_|stack|api\.groq/i.test(mov + big));
});
test('extraction failure message hints at a missing audio track', () => {
  const { extractionFailureMessage } = require('../utils/limits');
  const msg = extractionFailureMessage();
  assert.ok(msg.toLowerCase().includes('audio'));
  assert.ok(!/gsk_|ENOENT|stack/i.test(msg));
});
