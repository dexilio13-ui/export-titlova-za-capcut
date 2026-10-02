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
 * Extracts a compact mono 16 kHz audio track for speech recognition.
 * Prefers Opus in OGG (~14 MB per hour, accepted by Groq), falls back to MP3.
 *
 * @param {string} srcPath  uploaded media (temp file)
 * @param {string} dstPath  destination file (caller owns cleanup)
 * @returns {Promise<{path: string, codec: string, bytes: number}>}
 */
async function extractAudio(srcPath, dstPath) {
  const ffmpeg = resolveFfmpeg();
  if (ffmpeg === false) throw new Error('ffmpeg not available');

  const timeoutMs = parseInt(process.env.FFMPEG_TIMEOUT_MS || '300000', 10);
  const base = dstPath.replace(/\.(ogg|mp3)$/i, '');
  const attempts = [
    { out: base + '.ogg', codec: 'libopus', args: ['-c:a', 'libopus', '-b:a', '32k'] },
    { out: base + '.mp3', codec: 'libmp3lame', args: ['-c:a', 'libmp3lame', '-b:a', '48k'] },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      await run(ffmpeg, ['-y', '-i', srcPath, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', ...attempt.args, attempt.out], timeoutMs);
      const bytes = fs.statSync(attempt.out).size;
      return { path: attempt.out, codec: attempt.codec, bytes };
    } catch (err) {
      lastError = err;
      logger.warn('audio extraction attempt failed', { codec: attempt.codec, message: err.message });
    }
  }
  throw lastError || new Error('audio extraction failed');
}

module.exports = { resolveFfmpeg, hasFfmpeg, resolveFfprobe, probeDuration, extractAudio };