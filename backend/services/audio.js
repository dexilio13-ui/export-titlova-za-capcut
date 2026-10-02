'use strict';

/**
 * ffmpeg / ffprobe integration.
 *
 * All lookups are resolved once and cached. ffmpeg is optional: when it is
 * missing the API still works, it just forwards MP4 files to Groq untouched
 * and refuses MOV files with a clear message.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const logger = require('../utils/logger');

const CANDIDATES = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg'];

let cached = null; // false = checked, not found

/** Resolves the ffmpeg binary: FFMPEG_PATH → well-known paths → PATH lookup. */
function resolveFfmpeg() {
  if (cached !== null) return cached;

  const configured = (process.env.FFMPEG_PATH || '').trim();
  if (configured && fs.existsSync(configured)) {
    cached = configured;
    return cached;
  }

  for (const p of CANDIDATES) {
    if (fs.existsSync(p)) {
      cached = p;
      return cached;
    }
  }

  try {
    const out = execFileSync('ffmpeg', ['-version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (out) {
      cached = 'ffmpeg'; // resolvable through PATH
      return cached;
    }
  } catch (_) {
    /* not installed */
  }

  cached = false;
  return cached;
}

function hasFfmpeg() {
  return resolveFfmpeg() !== false;
}

function resolveFfprobe() {
  const ff = resolveFfmpeg();
  if (ff === false) return null;
  if (ff !== 'ffmpeg') {
    const sibling = path.join(path.dirname(ff), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(sibling)) return sibling;
  }
  try {
    execFileSync('ffprobe', ['-version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    return 'ffprobe';
  } catch (_) {
    return null;
  }
}

/** Best-effort media duration in seconds (null when unknown). */
function probeDuration(filePath) {
  const ffprobe = resolveFfprobe();
  if (!ffprobe) return null;
  try {
    const out = execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 20000, encoding: 'utf8' }
    );
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) ? d : null;
  } catch (err) {
    logger.warn('ffprobe failed', { message: err.message });
    return null;
  }
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timer = null;

    proc.stderr.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve();
      const err = new Error('ffmpeg exited with code ' + code);
      err.stderr = stderr;
      reject(err);
    });

    if (timeoutMs) {
      timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) { /* already gone */ }
        reject(new Error('ffmpeg timed out'));
      }, timeoutMs);
    }
  });
}

/**
 * Codecs whose audio track can be copied straight out of the container
 * (no re-encode). Remuxing is I/O-bound and near-instant, while re-encoding
 * costs real CPU — on a small instance that difference is the whole runtime.
 */
const COPYABLE_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'alac']);

/**
 * Video codecs the transcription API can usually decode directly. Phones often
 * record HEVC/H.265, VP9 or AV1 instead, which the API rejects — those files
 * are routed through audio extraction even when they are small.
 */
const FRIENDLY_VIDEO_CODECS = new Set(['h264', 'avc1', 'mpeg4', 'mp4v']);

/**
 * Reads the first video stream's codec with ffprobe (null when unknown).
 * @param {string} filePath
 * @returns {string|null}
 */
function probeVideoCodec(filePath) {
  const ffprobe = resolveFfprobe();
  if (!ffprobe) return null;
  try {
    const out = execFileSync(
      ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 20000, encoding: 'utf8' }
    );
    const codec = String(out).trim().split('\n')[0].toLowerCase();
    return codec && codec !== 'unknown' && codec !== 'n/a' ? codec : null;
  } catch (_) {
    return null;
  }
}

/** True when the video track should be stripped before sending to the API. */
function needsVideoStrip(codec) {
  if (!codec) return false;
  return !FRIENDLY_VIDEO_CODECS.has(codec);
}

/**
 * Reads the first audio stream's codec with ffprobe (null when unknown).
 * @param {string} filePath
 * @returns {{codecName: string, bitRate: number|null}|null}
 */
function probeAudioStream(filePath) {
  const ffprobe = resolveFfprobe();
  if (!ffprobe) return null;
  try {
    const out = execFileSync(
      ffprobe,
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,bit_rate',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 20000, encoding: 'utf8' }
    );
    const lines = String(out).trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const codecName = (lines.find((l) => !l.includes('=')) || '').toLowerCase();
    const bitRateLine = lines.find((l) => l.startsWith('bit_rate='));
    const bitRate = bitRateLine ? parseInt(bitRateLine.split('=')[1], 10) : null;
    if (!codecName || codecName === 'unknown' || codecName === 'n/a') return null;
    return { codecName, bitRate: Number.isFinite(bitRate) ? bitRate : null };
  } catch (_) {
    return null;
  }
}

/**
 * Decides how to get audio out of the uploaded media.
 * Pure function so the policy can be unit tested.
 * @param {{codecName: string}|null} stream
 * @returns {'copy'|'encode'}
 */
function chooseStrategy(stream) {
  if (stream && typeof stream.codecName === 'string') {
    if (COPYABLE_CODECS.has(stream.codecName.trim().toLowerCase())) return 'copy';
  }
  return 'encode';
}

/**
 * Extracts a usable audio track for speech recognition.
 *
 * Strategy:
 *  1. remux the existing audio track without re-encoding (fast) when its codec
 *     is already compact and friendly to Groq;
 *  2. otherwise encode mono 16 kHz Opus (~14 MB/hour), with MP3 as a fallback.
 *
 * @param {string} srcPath   uploaded media (temp file)
 * @param {string} dstPath   destination file (caller owns cleanup)
 * @param {{maxBytes?: number}} opts when the copy would exceed the cap, we encode
 * @returns {Promise<{path: string, codec: string, bytes: number, strategy: string}>}
 */
async function extractAudio(srcPath, dstPath, opts = {}) {
  const ffmpeg = resolveFfmpeg();
  if (ffmpeg === false) throw new Error('ffmpeg not available');

  const timeoutMs = parseInt(process.env.FFMPEG_TIMEOUT_MS || '300000', 10);
  const maxBytes = opts.maxBytes || Infinity;
  const base = dstPath.replace(/\.(ogg|mp3|m4a)$/i, '');
  const common = ['-y', '-i', srcPath, '-vn', '-map', '0:a:0'];

  const attempts = [];
  if (chooseStrategy(probeAudioStream(srcPath)) === 'copy') {
    attempts.push({ out: base + '.m4a', codec: 'copy', strategy: 'copy', args: ['-c:a', 'copy'] });
  }
  attempts.push(
    { out: base + '.ogg', codec: 'libopus', strategy: 'encode', args: ['-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k'] },
    { out: base + '.mp3', codec: 'libmp3lame', strategy: 'encode', args: ['-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k'] }
  );

  let lastError = null;
  for (const attempt of attempts) {
    try {
      await run(ffmpeg, [...common, ...attempt.args, attempt.out], timeoutMs);
      const bytes = fs.statSync(attempt.out).size;
      if (bytes > maxBytes) {
        // Remuxed track is still too big for the transcription API → re-encode.
        logger.warn('copied audio too large, falling back to encoding', { bytes });
        try { fs.unlinkSync(attempt.out); } catch (_) { /* ignore */ }
        continue;
      }
      return { path: attempt.out, codec: attempt.codec, bytes, strategy: attempt.strategy };
    } catch (err) {
      lastError = err;
      logger.warn('audio extraction attempt failed', { codec: attempt.codec, message: err.message });
    }
  }
  throw lastError || new Error('audio extraction failed');
}

module.exports = {
  resolveFfmpeg,
  hasFfmpeg,
  resolveFfprobe,
  probeDuration,
  probeAudioStream,
  chooseStrategy,
  probeVideoCodec,
  needsVideoStrip,
  extractAudio,
};