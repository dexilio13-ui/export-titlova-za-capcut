'use strict';

/**
 * Tests for the central error handler:
 *  - client mistakes are warnings, not errors (real failures stay visible)
 *  - stack traces and internals never reach the client
 */

const test = require('node:test');
const assert = require('node:assert');

const { errorHandler } = require('../middleware/errors');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/** Minimal express-like req/res doubles. */
function makeReq() {
  return { originalUrl: '/api/transcribe' };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function capture(fn) {
  const calls = [];
  const origWarn = logger.warn;
  const origError = logger.error;
  const origLog = console.log;
  logger.warn = (msg, meta) => calls.push({ level: 'warn', msg, meta });
  logger.error = (msg, meta) => calls.push({ level: 'error', msg, meta });
  console.log = () => {};
  try {
    fn();
  } finally {
    logger.warn = origWarn;
    logger.error = origError;
    console.log = origLog;
  }
  return calls;
}

test('a rejected file type is a warning, not an error', () => {
  const res = makeRes();
  const calls = capture(() =>
    errorHandler(
      new AppError(415, 'Unsupported file. Please upload an MP4 or MOV video.', { code: 'UNSUPPORTED_TYPE' }),
      makeReq(),
      res,
      () => {}
    )
  );
  assert.strictEqual(res.statusCode, 415);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].level, 'warn');
  assert.ok(calls[0].meta.stack === undefined, 'warning ne sme nositi stack');
});

test('unexpected failures stay errors, with the stack kept server-side', () => {
  const res = makeRes();
  const boom = new Error('kaboom');
  const calls = capture(() => errorHandler(boom, makeReq(), res, () => {}));
  assert.strictEqual(res.statusCode, 500);
  assert.strictEqual(calls[0].level, 'error');
  assert.ok(calls[0].meta.stack, 'stack ostaje u logu');
});

test('the response never contains a stack trace or internal message', () => {
  const res = makeRes();
  capture(() =>
    errorHandler(new Error('DATABASE_PASSWORD=hunter2 at /app/secret.js'), makeReq(), res, () => {})
  );
  const serialized = JSON.stringify(res.body);
  assert.ok(!/hunter2|at \/|node_modules|DATABASE_PASSWORD/.test(serialized));
  assert.strictEqual(res.body.error, 'Transcription failed. Please check your video and try again.');
});

test('size errors carry the real limits so the UI can show the right number', () => {
  const res = makeRes();
  capture(() =>
    errorHandler(
      new AppError(413, 'File is too large.', { code: 'FILE_TOO_LARGE' }),
      makeReq(),
      res,
      () => {}
    )
  );
  assert.strictEqual(res.body.code, 'FILE_TOO_LARGE');
  assert.ok(res.body.maxFileSizeMB > 0);
  assert.ok(res.body.maxUploadMB >= res.body.maxFileSizeMB);
});
