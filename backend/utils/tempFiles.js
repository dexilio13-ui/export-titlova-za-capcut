'use strict';

/**
 * Safe temporary-file helpers.
 *
 * Uploads are streamed to disk under random names inside backend/uploads, so
 * large videos never sit in RAM and user input never influences a path.
 * Files are deleted as soon as transcription finishes; a sweep removes
 * anything older than 1 hour left behind by a crashed run.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Sanitizes an extension to a short, safe suffix (".mp4"). */
function safeExt(originalName) {
  const raw = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
  if (!raw || raw === '.') return '.bin';
  return raw;
}

/** Builds a unique path inside the upload dir without creating the file. */
function tempPathFor(ext) {
  ensureUploadDir();
  const name = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${safeExt(ext)}`;
  const filePath = path.join(UPLOAD_DIR, name);
  if (!filePath.startsWith(UPLOAD_DIR + path.sep)) throw new Error('Invalid temp path');
  return filePath;
}

/** Multer disk storage: random safe names, no user-controlled paths. */
function createTempStorage() {
  const multer = require('multer');
  return multer.diskStorage({
    destination(req, file, cb) {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    },
    filename(req, file, cb) {
      cb(null, path.basename(tempPathFor(safeExt(file.originalname))));
    },
  });
}

/** Deletes a temp file, ignoring "already gone". */
async function removeFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (_) {
    /* already gone */
  }
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

module.exports = {
  UPLOAD_DIR,
  ensureUploadDir,
  safeExt,
  tempPathFor,
  createTempStorage,
  removeFile,
  sweepOldFiles,
};