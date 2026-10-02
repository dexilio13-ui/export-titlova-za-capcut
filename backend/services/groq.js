'use strict';

/**
 * Groq Speech-to-Text service (OpenAI-compatible endpoint).
 *
 * Current API (verified against https://console.groq.com/docs/speech-to-text):
 *   POST https://api.groq.com/openai/v1/audio/transcriptions
 *   - model:        whisper-large-v3-turbo | whisper-large-v3
 *   - response_format: verbose_json (required for timestamps)
 *   - timestamp_granularities[]: segment, word (both allowed with verbose_json)
 *   - language:     optional ISO-639-1 code (e.g. "sr")
 *   - prompt:       optional, max 224 tokens, guides style/spelling
 *
 * File limits: 25 MB (free tier) / 100 MB (dev tier). The app-level limit is
 * enforced by MAX_FILE_SIZE_MB before we ever hit the API.
 */

const fs = require('fs');
const path = require('path');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');
const { mapGroqError } = require('../utils/mapGroqError');
const { normalize } = require('./normalize');

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'whisper-large-v3-turbo';
const SERBIAN_PROMPT =
  'Transcribe in Serbian. Use correct Serbian Latin or Cyrillic as spoken, ' +
  'with proper diacritics č, ć, š, ž, đ and natural punctuation.';

/**
 * Minimal multipart/form-data body builder (no external dependency).
 * @param {Array<{name: string, value: string}>} fields
 * @param {{name: string, filename: string, contentType: string, buffer: Buffer}} file
 */
function buildMultipart(fields, file) {
  const boundary = '----serbiantranscriber' + Math.random().toString(36).slice(2);
  const parts = [];

  for (const f of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`,
        'utf8'
      )
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename.replace(/"/g, '')}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
      'utf8'
    ),
    file.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  );

  return { body: Buffer.concat(parts), boundary };
}

/**
 * @param {string} filePath absolute path to the uploaded media file
 * @param {string} language ISO-639-1 code or empty/"auto"
 * @returns {Promise<object>} normalized { language, segments, words }
 */
async function transcribe(filePath, language) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AppError(500, 'Server is not configured for transcription. Contact the site owner.', {
      code: 'NO_API_KEY',
    });
  }

  let fileBuffer;
  try {
    fileBuffer = await fs.promises.readFile(filePath);
  } catch (err) {
    throw new AppError(500, 'Transcription failed. Please check your video and try again.', {
      code: 'READ_FAILED',
    });
  }

  const fields = [
    { name: 'model', value: GROQ_MODEL },
    { name: 'response_format', value: 'verbose_json' },
    { name: 'timestamp_granularities[]', value: 'segment' },
    { name: 'timestamp_granularities[]', value: 'word' },
    { name: 'temperature', value: '0' },
  ];

  if (language && language !== 'auto') {
    // ISO-639-1 hint; improves accuracy and latency. Ignored by API if unknown.
    fields.push({ name: 'language', value: language });
  } else {
    // Language auto-detect: a Serbian prompt steers style/diacritics without forcing.
    fields.push({ name: 'prompt', value: SERBIAN_PROMPT });
  }

  const { body, boundary } = buildMultipart(fields, {
    name: 'file',
    filename: path.basename(filePath),
    contentType: 'application/octet-stream',
    buffer: fileBuffer,
  });

  logger.info('Sending file to Groq', { bytes: fileBuffer.length, model: GROQ_MODEL, language });

  let res;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw mapGroqError({ code: 'ETIMEDOUT' });
    }
    throw mapGroqError(err);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) || '';
    } catch (_) {
      detail = '';
    }
    logger.error('Groq API error', { status: res.status, detail: detail.slice(0, 300) });
    throw mapGroqError({ status: res.status, message: detail });
  }

  let raw;
  try {
    raw = await res.json();
  } catch (err) {
    throw new AppError(502, 'Transcription failed. Please check your video and try again.', {
      code: 'MALFORMED_RESPONSE',
    });
  }

  return normalizeGroq(raw);
}

/**
 * Converts a Groq verbose_json payload into the canonical normalized shape
 * (see ./normalize.js). Falls back gracefully: if no word timestamps exist,
 * words = [] and the app uses segment timestamps only.
 */
function normalizeGroq(raw) {
  return normalize(raw);
}

module.exports = { transcribe, normalizeGroq };
