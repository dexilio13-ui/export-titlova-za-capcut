'use strict';

/**
 * Safe temporary-file helpers. Files live in backend/uploads with random names,
 * are never user-controlled, and are always cleaned up after transcription.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * @param {Buffer} buffer
 * @param {string} originalName only used to derive a safe extension
 * @returns {{dir: string, path: string, cleanup: () => Promise<void>}}
 */
function writeTemp(buffer, originalName) {
  ensureUploadDir();
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
  const safeName = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
  const filePath = path.join(UPLOAD_DIR, safeName);

  // Double-check the resolved path stays inside the upload dir (anti-traversal).
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error('Invalid temp path');
  }

  fs.writeFileSync(filePath, buffer);
  return {
    dir: UPLOAD_DIR,
    path: filePath,
    cleanup: async () => {
      try {
        await fs.promises.unlink(filePath);
      } catch (_) {
        /* already gone */
      }
    },
  };
}

/** Deletes stray temp files older than 1 hour (crash recovery). */
function sweepOldFiles() {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of files) {
      const p = path.join(UPLOAD_DIR, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    /* dir may not exist yet */
  }
}

module.exports = { writeTemp, sweepOldFiles, UPLOAD_DIR };
