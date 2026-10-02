'use strict';

/**
 * Application error with an HTTP status and a safe, user-facing message.
 * `safeMessage` is what the frontend shows. Technical details never leave
 * the server (they are only logged).
 */
class AppError extends Error {
  constructor(statusCode, safeMessage, options = {}) {
    super(safeMessage);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.safeMessage = safeMessage;
    this.code = options.code || 'APP_ERROR';
    this.details = options.details || null;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { AppError };
