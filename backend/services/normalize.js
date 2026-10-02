'use strict';

/**
 * Normalizes Groq Whisper responses into the app's canonical shape:
 *
 * {
 *   language: "sr",
 *   segments: [{ start, end, text }],
 *   words:    [{ word, start, end }]
 * }
 *
 * Only real timestamps from the API are used. Nothing is invented:
 * if word-level timestamps are missing we return an empty words array and
 * the app gracefully falls back to segment timestamps only.
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(raw) {
  const out = { language: 'auto', segments: [], words: [] };

  if (!raw || typeof raw !== 'object') return out;

  if (typeof raw.language === 'string' && raw.language) {
    out.language = raw.language;
  }

  const segments = Array.isArray(raw.segments) ? raw.segments : [];
  for (const s of segments) {
    const start = toNumber(s && s.start);
    const end = toNumber(s && s.end);
    const text = typeof (s && s.text) === 'string' ? s.text.trim() : '';
    if (start === null || end === null || !text) continue;
    out.segments.push({ start, end, text });
  }

  const words = Array.isArray(raw.words) ? raw.words : [];
  for (const w of words) {
    const word = typeof (w && w.word) === 'string' ? w.word.trim() : '';
    const start = toNumber(w && w.start);
    const end = toNumber(w && w.end);
    if (!word || start === null || end === null) continue;
    out.words.push({ word, start, end });
  }

  // Stable ordering + 1-based ids for the frontend/SRT numbering.
  out.segments.sort((a, b) => a.start - b.start);
  out.segments.forEach((s, i) => {
    s.id = i + 1;
  });
  out.words.sort((a, b) => a.start - b.start);

  return out;
}

module.exports = { normalize };
