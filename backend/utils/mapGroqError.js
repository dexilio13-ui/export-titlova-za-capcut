'use strict';

/**
 * Maps low-level Groq API failures to safe, typed AppErrors.
 */

const { AppError } = require('../utils/errors');

/**
 * @param {Error & {status?: number, code?: string}} err
 */
function mapGroqError(err) {
  const status = err && (err.status || err.statusCode);
  const raw = String((err && err.message) || '').toLowerCase();

  if (status === 401) {
    return new AppError(500, 'Transcription failed. Please check your video and try again.', {
      code: 'GROQ_AUTH',
    });
  }
  if (status === 413 || raw.includes('too large')) {
    return new AppError(413, 'File is too large.', { code: 'FILE_TOO_LARGE' });
  }
  if (status === 429) {
    return new AppError(429, 'Server is busy. Please wait a moment and try again.', {
      code: 'RATE_LIMITED',
    });
  }
  if (status && status >= 500) {
    return new AppError(502, 'Transcription failed. Please check your video and try again.', {
      code: 'GROQ_UPSTREAM',
    });
  }
  if (err && (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || raw.includes('timeout'))) {
    return new AppError(504, 'Transcription failed. Please check your video and try again.', {
      code: 'API_TIMEOUT',
    });
  }
  if (err && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED')) {
    return new AppError(502, 'Server is temporarily unavailable. Please try again.', {
      code: 'NETWORK',
    });
  }
  return new AppError(502, 'Transcription failed. Please check your video and try again.', {
    code: 'GROQ_ERROR',
  });
}

module.exports = { mapGroqError };
