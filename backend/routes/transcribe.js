'use strict';

/**
 * POST /api/transcribe
 * multipart/form-data:  video=<file>, language=<auto|sr|en|hr|bs|me>
 *
 * Flow: validate → temp file → (optional ffmpeg audio extraction) → Groq →
 * normalized JSON → delete temp files. Videos are never stored permanently.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const { writeTemp } = require('../utils/tempFiles');
const { transcribe } = require('../services/groq');

const router = express.Router();

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10);
const FFMPEG_PATH = (process.env.FFMPEG_PATH || '').trim();

// Selector values the frontend may send. Montenegrin has no ISO-639-1 code,
// so it is mapped to Serbian (the closest supported Whisper language).
const LANGUAGE_MAP = {
  auto: '',
  sr: 'sr',
  en: 'en',
  hr: 'hr',
  bs: 'bs',
  me: 'sr',
};

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov']);
const ALLOWED_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'application/octet-stream', // some browsers send this for .mov
  '', // or nothing at all — extension check still applies
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new AppError(415, 'Unsupported file. Please upload an MP4 or MOV video.', { code: 'UNSUPPORTED_TYPE' }));
    }
    if (!ALLOWED_MIMES.has((file.mimetype || '').toLowerCase())) {
      return cb(new AppError(415, 'Unsupported file. Please upload an MP4 or MOV video.', { code: 'UNSUPPORTED_TYPE' }));
    }
    cb(null, true);
  },
});

function hasFfmpeg() {
  return FFMPEG_PATH.length > 0 && fs.existsSync(FFMPEG_PATH);
}

/** Reads media duration with ffprobe (best effort; returns null on failure). */
function probeDuration(filePath) {
  if (!hasFfmpeg()) return null;
  const ffprobe = path.join(path.dirname(FFMPEG_PATH), 'ffprobe');
  if (!fs.existsSync(ffprobe)) return null;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 10000, encoding: 'utf8' }
    );
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) ? d : null;
  } catch (_) {
    return null;
  }
}

/** Extracts a compact mono 16 kHz MP3 audio track (async). */
function extractAudio(srcPath, dstPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, ['-y', '-i', srcPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', dstPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += String(d);
      if (err.length > 8000) err = err.slice(-8000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      logger.error('ffmpeg extraction failed', { code, stderr: err.slice(-500) });
      reject(new AppError(500, 'Transcription failed. Please check your video and try again.', { code: 'FFMPEG_FAILED' }));
    });
  });
}

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'serbian-transcriber-api',
    model: process.env.GROQ_MODEL || 'whisper-large-v3-turbo',
    maxFileSizeMB: MAX_FILE_SIZE_MB,
    movSupport: hasFfmpeg(),
  });
});

router.post('/transcribe', (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(
        new AppError(413, `File is too large. The maximum allowed size is ${MAX_FILE_SIZE_MB} MB.`, {
          code: 'FILE_TOO_LARGE',
        })
      );
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError(400, 'Invalid upload. Use the "video" field for your file.', { code: 'BAD_FIELD' }));
    }
    next(err);
  });
});

// Actual handler (separate so multer errors flow through next(err) above).
router.post('/transcribe', async (req, res, next) => {
  const started = Date.now();

  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      throw new AppError(400, 'No video file was uploaded.', { code: 'NO_FILE' });
    }

    const originalName = path.basename(req.file.originalname || 'video.mp4').slice(0, 180);
    const ext = path.extname(originalName).toLowerCase();

    let language = LANGUAGE_MAP[String(req.body.language || 'sr').toLowerCase()];
    if (language === undefined) language = ''; // unknown selector value → auto-detect

    logger.info('Upload received', {
      name: originalName,
      bytes: req.file.buffer.length,
      mime: req.file.mimetype,
      language: language || 'auto',
    });

    const tmp = writeTemp(req.file.buffer, originalName);
    let audioTmp = null;

    try {
      // MOV files and oversized MP4s go through ffmpeg audio extraction when
      // available; plain MP4 within the size limit is sent directly (Groq
      // accepts mp4 natively).
      let fileForGroq = tmp.path;
      const needsExtraction = ext === '.mov' || req.file.buffer.length > (MAX_FILE_SIZE_MB - 1) * 1024 * 1024;

      if (needsExtraction) {
        if (!hasFfmpeg()) {
          if (ext === '.mov') {
            throw new AppError(
              415,
              'MOV files require server-side audio conversion. Please upload an MP4 or convert your video.',
              { code: 'MOV_UNAVAILABLE' }
            );
          }
          // Oversized MP4 without ffmpeg: let Groq decide; it may still accept it.
        } else {
          audioTmp = writeTemp(Buffer.alloc(0), 'audio.mp3');
          await extractAudio(tmp.path, audioTmp.path);
          fileForGroq = audioTmp.path;
          logger.info('Audio extracted', { from: originalName });
        }
      }

      const duration = probeDuration(tmp.path);
      const result = await transcribe(fileForGroq, language);

      logger.info('Transcription complete', {
        segments: result.segments.length,
        words: result.words.length,
        ms: Date.now() - started,
      });

      res.json({
        success: true,
        filename: originalName,
        language: result.language,
        duration: duration,
        model: process.env.GROQ_MODEL || 'whisper-large-v3-turbo',
        segments: result.segments,
        words: result.words,
      });
    } finally {
      await tmp.cleanup();
      if (audioTmp) await audioTmp.cleanup();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
