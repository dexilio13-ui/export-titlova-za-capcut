'use strict';

/**
 * Upload-size policy, kept pure so it can be unit tested without Express.
 *
 * Two different limits are in play:
 *   MAX_UPLOAD_MB    – how big a video the browser may send us (disk temp file)
 *   MAX_FILE_SIZE_MB – the Groq tier limit for what we send to Groq
 *                      (25 MB free tier, 100 MB dev tier)
 *
 * When ffmpeg is available, MOV files and anything bigger than the Groq limit
 * are converted to compact mono 16 kHz audio first, so a 500 MB video can end
 * up as a ~14 MB .ogg that Groq accepts.
 */

const MB = 1024 * 1024;

function intEnv(env, name, fallback) {
  const raw = parseInt((env[name] === undefined ? '' : env[name]) || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{maxFileSizeMB: number, maxUploadMB: number}}
 */
function getLimits(env) {
  const e = env || process.env;
  const maxFileSizeMB = intEnv(e, 'MAX_FILE_SIZE_MB', 25);
  const maxUploadMB = Math.max(maxFileSizeMB, intEnv(e, 'MAX_UPLOAD_MB', maxFileSizeMB));
  return { maxFileSizeMB, maxUploadMB };
}

/**
 * What should the backend do with this upload?
 * @param {{extension: string, sizeBytes: number, limits: {maxFileSizeMB:number,maxUploadMB:number}, canExtract: boolean}} input
 * @returns {{action: 'accept'|'extract'|'reject', reason?: 'mov'|'too_large'}}
 */
function decideMediaAction(input) {
  const ext = String(input.extension || '').toLowerCase();
  const size = Number(input.sizeBytes) || 0;
  const groqBytes = input.limits.maxFileSizeMB * MB;

  const isMov = ext === '.mov';
  const overGroqLimit = size > groqBytes;

  if (!isMov && !overGroqLimit) return { action: 'accept' };
  if (input.canExtract) return { action: 'extract' };
  return { action: 'reject', reason: isMov ? 'mov' : 'too_large' };
}

/**
 * Clear, non-technical message for a rejected upload.
 * @param {'mov'|'too_large'} reason
 * @param {{maxFileSizeMB: number}} limits
 */
function rejectionMessage(reason, limits) {
  if (reason === 'mov') {
    return 'MOV files require server-side audio conversion, which is not enabled on this server. Please upload an MP4.';
  }
  return (
    'File is too large. This server sends files directly to the transcription service, ' +
    `which accepts up to ${limits.maxFileSizeMB} MB. Please use a shorter video or compress it.`
  );
}

/**
 * Friendly message when audio extraction fails. The most common cause by far
 * is a video that simply has no audio track (muted clip), so we say so.
 */
function extractionFailureMessage() {
  return (
    'We could not read the audio track from this video. ' +
    'Please check that the video contains audio (it may be muted or silent).'
  );
}

module.exports = { MB, getLimits, decideMediaAction, rejectionMessage, extractionFailureMessage };