'use strict';

/**
 * 404 handler + central error handler.
 * Never leaks stack traces, env vars or secrets to the client.
 */

const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = 500;
  let safeMessage = 'Transcription failed. Please check your video and try again.';
  let code = 'INTERNAL_ERROR';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    safeMessage = err.safeMessage;
    code = err.code;
  } else if (err && err.type === 'entity.too.large') {
    statusCode = 413;
    safeMessage = 'File is too large.';
    code = 'FILE_TOO_LARGE';
  } else if (err && err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    safeMessage = 'File is too large.';
    code = 'FILE_TOO_LARGE';
  }

  // Client mistakes (wrong type, too large, no speech) are expected traffic,
  // not incidents: log them as warnings so real failures stay visible.
  if (statusCode >= 400 && statusCode < 500) {
    logger.warn(`Client error (${statusCode}): ${safeMessage}`, {
      path: req.originalUrl,
      code: code,
    });
  } else {
    // Full technical detail stays server-side only.
    logger.error(`Request error: ${err && err.message}`, {
      path: req.originalUrl,
      code: err && err.code,
      stack: err && err.stack,
    });
  }

  // Include the real caps so the UI can show an accurate number instead of guessing.
  const body = { success: false, error: safeMessage, code };
  try {
    const { getLimits } = require('../utils/limits');
    const limits = getLimits(process.env);
    body.maxFileSizeMB = limits.maxFileSizeMB;
    body.maxUploadMB = limits.maxUploadMB;
  } catch (_) {
    /* limits are optional context only */
  }
  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
