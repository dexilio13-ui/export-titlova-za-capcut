'use strict';

/**
 * Tests for the upload-retry policy and the per-request temp folder cleanup
 * that keeps aborted uploads from filling the disk.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Load the browser module with a `window` shim, like the transcription tests.
global.window = {};
require(path.join(__dirname, '..', '..', 'frontend', 'js', 'upload.js'));
const U = global.window.UploadLib;

const { UPLOAD_DIR, removeRequestTemp, sweepOldFiles } = require('../utils/tempFiles');

test('a drop before any bytes looks like a connection/backend problem', () => {
  assert.strictEqual(U.classifyNetworkFailure(0, false), 'network');
  assert.strictEqual(U.classifyNetworkFailure(0.001, false), 'network');
});

test('a drop after the upload started is reported as an interrupted upload', () => {
  assert.strictEqual(U.classifyNetworkFailure(0.42, false), 'upload_interrupted');
  assert.strictEqual(U.classifyNetworkFailure(1, false), 'upload_interrupted');
});

test('once retries are used up it stops blaming the backend URL', () => {
  assert.strictEqual(U.classifyNetworkFailure(0, true), 'upload_interrupted');
  assert.strictEqual(U.classifyNetworkFailure(0.8, true), 'upload_interrupted');
});

test('retry backoff is short and bounded', () => {
  assert.strictEqual(U.retryDelay(1), 1000);
  assert.strictEqual(U.retryDelay(2), 3000);
});

test('the two messages tell the user something different to do', () => {
  const url = U.friendlyError('network');
  const dropped = U.friendlyError('upload_interrupted');
  assert.ok(/config\.js/.test(url), 'mrežna greška upućuje na podešavanje backend URL-a');
  assert.ok(/connection dropped/i.test(dropped), 'prekid uploada se opisuje drugačije');
  assert.ok(/Try again/.test(dropped), 'poruka nudi ponovni pokušaj');
  assert.notStrictEqual(url, dropped);
});

test('per-request temp folders are removed entirely, including partial files', async () => {
  const req = { tempDir: path.join(UPLOAD_DIR, 'test-' + Date.now()) };
  fs.mkdirSync(req.tempDir, { recursive: true });
  fs.writeFileSync(path.join(req.tempDir, 'upload.mp4'), Buffer.alloc(2048));

  await removeRequestTemp(req);

  assert.strictEqual(fs.existsSync(req.tempDir), false, 'folder mora biti obrisan');
  assert.strictEqual(req.tempDir, null, 'req.tempDir mora biti ispraznjen');
});

test('cleanup is safe to call twice or without a folder', async () => {
  await removeRequestTemp({});
  await removeRequestTemp({ tempDir: null });
  await removeRequestTemp({ tempDir: path.join(UPLOAD_DIR, 'ne-postoji') });
});

test('the crash-recovery sweep also clears stale folders', () => {
  const stale = path.join(UPLOAD_DIR, 'stale-' + Date.now());
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'upload.mp4'), 'x');
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);

  sweepOldFiles();

  assert.strictEqual(fs.existsSync(stale), false);
});
