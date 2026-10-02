'use strict';

/**
 * Upload-size and media policy, kept pure so it can be unit tested without
 * Express, ffmpeg or the network.
 *
 * Two different limits are in play:
 *   MAX_UPLOAD_MB    – how big a video the browser may send us (disk temp file)
 *   MAX_FILE_SIZE_MB – the Groq tier limit for what we send to Groq
 *                      (25 MB free tier, 100 MB dev tier)
 *
 * The transcription API only ever needs audio. Sending a whole video is
 * wasteful and codec-dependent, so the default policy is to extract the audio
 * first and send that. See planMedia() for the exact rules.
 */

const MB = 1024 * 1024;

function intEnv(env, name, fallback) {
  const raw = parseInt((env[name] === undefined ? '' : env[name]) || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function boolEnv(env, name, fallback) {
  const raw = String((env[name] === undefined ? '' : env[name])).trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{maxFileSizeMB: number, maxUploadMB: number, alwaysExtract: boolean}}
 */
function getLimits(env) {
  const e = env || process.env;
  const maxFileSizeMB = intEnv(e, 'MAX_FILE_SIZE_MB', 25);
  const maxUploadMB = Math.max(maxFileSizeMB, intEnv(e, 'MAX_UPLOAD_MB', maxFileSizeMB));
  return {
    maxFileSizeMB,
    maxUploadMB,
    // Default: always hand the API audio only. Faster for the API to accept,
    // far smaller payload, and independent of the video codec.
    alwaysExtract: boolEnv(e, 'ALWAYS_EXTRACT_AUDIO', true),
  };
}

/**
 * Base decision based on container and size.
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
 * Full plan for an upload.
 *
 * Order of preference:
 *   1. refuse when we cannot help at all (no ffmpeg + MOV/oversized)
 *   2. extract audio whenever ffmpeg is available (default)
 *   3. only forward the raw file when audio extraction is unavailable
 *
 * @param {object} input
 * @param {string} input.extension            ".mp4" / ".mov"
 * @param {number} input.sizeBytes
 * @param {{maxFileSizeMB:number,maxUploadMB:number,alwaysExtract:boolean}} input.limits
 * @param {boolean} input.canExtract           ffmpeg present?
 * @param {boolean} [input.videoNeedsStrip]    true for HEVC/VP9/AV1 etc.
 * @returns {{action: 'accept'|'extract'|'reject', reason?: string}}
 */
function planMedia(input) {
  const base = decideMediaAction(input);
  if (base.action === 'reject') return base;
  if (!input.canExtract) return base;

  if (input.limits.alwaysExtract) return { action: 'extract', reason: 'always_extract' };
  if (base.action === 'accept' && input.videoNeedsStrip) {
    return { action: 'extract', reason: 'video_codec' };
  }
  return base;
}

/**
 * Friendly message for a rejected upload.
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

/** Friendly message when audio extraction fails. */
function extractionFailureMessage() {
  return (
    'We could not read the audio track from this video. ' +
    'Please check that the video contains audio (it may be muted or silent).'
  );
}

module.exports = {
  MB,
  getLimits,
  boolEnv,
  decideMediaAction,
  planMedia,
  rejectionMessage,
  extractionFailureMessage,
};