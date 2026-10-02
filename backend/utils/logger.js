'use strict';

/**
 * Tiny structured logger. Never logs request bodies, file contents or secrets.
 */

function ts() {
  return new Date().toISOString();
}

function line(level, message, meta) {
  const base = `${ts()} [${level}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    // Meta values are filtered: never print anything that looks like a key.
    const safe = {};
    for (const [k, v] of Object.entries(meta)) {
      if (/key|token|secret|auth|password/i.test(k)) {
        safe[k] = '[REDACTED]';
      } else {
        safe[k] = v;
      }
    }
    console[level === 'error' ? 'error' : 'log'](base, JSON.stringify(safe));
  } else {
    console[level === 'error' ? 'error' : 'log'](base);
  }
}

module.exports = {
  info: (msg, meta) => line('info', msg, meta),
  warn: (msg, meta) => line('warn', msg, meta),
  error: (msg, meta) => line('error', msg, meta),
};
