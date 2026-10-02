'use strict';

/**
 * GET  /api/health      → limits + capability info for the frontend
 * POST /api/transcribe  → multipart/form-data: video=<file>, [language]
 *
 * Flow: validate → stream to temp file → (optional ffmpeg audio extraction)
 * → Groq → normalized JSON → delete temp files. Videos are never kept.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');

const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const { getLimits, decideMediaAction, rejectionMessage, extractionFailureMessage, MB } = require('../utils/limits');
const { createTempStorage, tempPathFor, removeFile } = require('../utils/tempFiles');
const { hasFfmpeg, probeDuration, extractAudio } = require('../services/audio');
const { transcribe } = require('../services/groq');

const router = express.Router();

const LIMITS = getLimits(process.env);

// Selector values the frontend may send. Montenegrin has no ISO-639-1 code,
// so it is mapped to Serbian (closest supported Whisper language).
const LANGUAGE_MAP = { auto: '', sr: 'sr', en: 'en', hr: 'hr', bs: 'bs', me: 'sr' };

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov']);
const ALLOWED_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'application/octet-stream', // some browsers send this for .mov
  '', // or nothing at all — extension check still applies
]);

const upload = multer({
  storage: createTempStorage(),
  limits: { fileSize: LIMITS.maxUploadMB * MB, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIMES.has(mime)) {
      return cb(
        new AppError(415, 'Unsupported file. Please upload an MP4 or MOV video.', { code: 'UNSUPPORTED_TYPE' })
      );
    }
    cb(null, true);
  },
});

router.get('/health', (req, res) => {
  const ffmpeg = hasFfmpeg();
  res.json({
    ok: true,
    service: 'serbian-transcriber-api',
    model: process.env.GROQ_MODEL || 'whisper-large-v3-turbo',
    maxFileSizeMB: LIMITS.maxFileSizeMB,
    maxUploadMB: LIMITS.maxUploadMB,
    ffmpeg: ffmpeg,
    movSupport: ffmpeg,
  });
});

// Multer runs first so its errors (file too large, wrong field) can be mapped.
router.post('/transcribe', (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      // Multer aborted the stream — remove whatever landed on disk.
      if (req.file) removeFile(req.file.path);
      return next(
        new AppError(
          413,
          `File is too large. The maximum accepted upload is ${LIMITS.maxUploadMB} MB.`,
          { code: 'FILE_TOO_LARGE' }
        )
      );
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError(400, 'Invalid upload. Use the "video" field for your file.', { code: 'BAD_FIELD' }));
    }
    next(err);
  });
});

router.post('/transcribe', async (req, res, next) => {
  const started = Date.now();

  try {
    if (!req.file) {
      throw new AppError(400, 'No video file was uploaded.', { code: 'NO_FILE' });
    }

    const originalName = path.basename(req.file.originalname || 'video.mp4').slice(0, 180);
    const ext = path.extname(originalName).toLowerCase();
    const canExtract = hasFfmpeg();
    let language = LANGUAGE_MAP[String(req.body.language || 'sr').toLowerCase()];
    if (language === undefined) language = ''; // unknown selector value → auto-detect

    logger.info('Upload received', {
      name: originalName,
      mb: (req.file.size / MB).toFixed(1),
      mime: req.file.mimetype,
      language: language || 'auto',
    });

    const uploadedPath = req.file.path;
    let audioPath = null;

    try {
      const action = decideMediaAction({
        extension: ext,
        sizeBytes: req.file.size,
        limits: LIMITS,
        canExtract: canExtract,
      });

      if (action.action === 'reject') {
        throw new AppError(
          action.reason === 'mov' ? 415 : 413,
          rejectionMessage(action.reason, LIMITS),
          { code: action.reason === 'mov' ? 'MOV_UNAVAILABLE' : 'FILE_TOO_LARGE' }
        );
      }

      let fileForGroq = uploadedPath;
      let conversion = null;

      if (action.action === 'extract') {
        const startedExtract = Date.now();
        let info;
        try {
          info = await extractAudio(uploadedPath, tempPathFor('.ogg'));
        } catch (err) {
          // Technical detail stays in the log; the user gets a useful hint.
          logger.error('Audio extraction failed', { message: err.message });
          throw new AppError(500, extractionFailureMessage(), { code: 'EXTRACTION_FAILED' });
        }
        audioPath = info.path;
        conversion = info;

        if (info.bytes > LIMITS.maxFileSizeMB * MB) {
          throw new AppError(
            413,
            `The audio track is still ${(info.bytes / MB).toFixed(1)} MB after conversion, ` +
              `above the ${LIMITS.maxFileSizeMB} MB limit. Please use a shorter video.`,
            { code: 'FILE_TOO_LARGE' }
          );
        }

        logger.info('Audio extracted', {
          codec: info.codec,
          mb: (info.bytes / MB).toFixed(1),
          ms: Date.now() - startedExtract,
        });
        fileForGroq = info.path;
      }

      const duration = probeDuration(uploadedPath);
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
        converted: Boolean(conversion),
        segments: result.segments,
        words: result.words,
      });
    } finally {
      await removeFile(uploadedPath);
      if (audioPath) await removeFile(audioPath);
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;