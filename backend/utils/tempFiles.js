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

/**
 * Multer disk storage: each request gets its own random subdirectory.
 *
 * When a client disconnects mid-upload the request still lands in this folder,
 * so cleanup is a single recursive delete — no orphaned partial files filling
 * the (ephemeral) disk.
 */
function createTempStorage() {
  const multer = require('multer');
  return multer.diskStorage({
    destination(req, file, cb) {
      ensureUploadDir();
      let dir;
      try {
        dir = path.join(UPLOAD_DIR, crypto.randomBytes(10).toString('hex'));
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        return cb(err);
      }
      req.tempDir = dir;
      cb(null, dir);
    },
    filename(req, file, cb) {
      cb(null, 'upload' + safeExt(file.originalname));
    },
  });
}

/** Removes this request's whole temp directory (upload + extracted audio). */
async function removeRequestTemp(req) {
  if (!req || !req.tempDir) return;
  const dir = req.tempDir;
  req.tempDir = null;
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (_) {
    /* already gone */
  }
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
    const entries = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true });
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const entry of entries) {
      const p = path.join(UPLOAD_DIR, entry.name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) {
          if (entry.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
          else fs.unlinkSync(p);
        }
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
  removeRequestTemp,
  sweepOldFiles,
};