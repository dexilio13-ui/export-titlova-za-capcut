'use strict';

/**
 * Unit tests for the frontend transcription library (SRT/TXT generation,
 * time conversion). The file is a browser script, so we shim `window`.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

global.window = {};
require(path.join(__dirname, '..', '..', 'frontend', 'js', 'transcription.js'));
const T = global.window.TranscriptionLib;

test('secondsToSrtTime formats HH:MM:SS,mmm with comma', () => {
  assert.strictEqual(T.secondsToSrtTime(0), '00:00:00,000');
  assert.strictEqual(T.secondsToSrtTime(2.5), '00:00:02,500');
  assert.strictEqual(T.secondsToSrtTime(3661.25), '01:01:01,250');
  assert.strictEqual(T.secondsToSrtTime(62.1234), '00:01:02,123');
});

test('secondsToSrtTime clamps invalid input instead of inventing timestamps', () => {
  assert.strictEqual(T.secondsToSrtTime(-5), '00:00:00,000');
  assert.strictEqual(T.secondsToSrtTime(NaN), '00:00:00,000');
});

test('srtTimeToSeconds parses both comma and dot forms', () => {
  assert.strictEqual(T.srtTimeToSeconds('00:00:02,500'), 2.5);
  assert.strictEqual(T.srtTimeToSeconds('01:01:01.250'), 3661.25);
  assert.strictEqual(T.srtTimeToSeconds('garbage'), null);
  assert.strictEqual(T.srtTimeToSeconds(''), null);
});

test('round-trip seconds -> srt time -> seconds', () => {
  for (const s of [0, 0.001, 1.25, 59.999, 3599.999, 7325.5]) {
    assert.ok(Math.abs(T.srtTimeToSeconds(T.secondsToSrtTime(s)) - s) < 0.001);
  }
});

test('generateSrt builds a valid numbered SRT with Serbian text', () => {
  const srt = T.generateSrt([
    { start: 0, end: 2.5, text: 'Danas ćemo pričati o veštačkoj inteligenciji.' },
    { start: 2.5, end: 5.1, text: 'Ovo je jednostavan primer transkripcije.' },
  ]);
  const expected =
    '1\n00:00:00,000 --> 00:00:02,500\nDanas ćemo pričati o veštačkoj inteligenciji.\n\n' +
    '2\n00:00:02,500 --> 00:00:05,100\nOvo je jednostavan primer transkripcije.\n';
  assert.strictEqual(srt, expected);
});

test('generateSrt skips empty lines and renumbers sequentially', () => {
  const srt = T.generateSrt([
    { start: 0, end: 1, text: 'Prva linija.' },
    { start: 1, end: 2, text: '   ' },
    { start: 2, end: 3, text: 'Druga linija.' },
  ]);
  assert.ok(!srt.includes('3\n'));
  assert.ok(srt.startsWith('1\n') && srt.includes('2\n00:00:02,000'));
});

test('generateTxt strips numbers and timestamps, keeps line-per-phrase', () => {
  const txt = T.generateTxt([
    { start: 0, end: 2.5, text: 'Danas ćemo pričati o veštačkoj inteligenciji.' },
    { start: 2.5, end: 5.1, text: 'Sada nastavljamo sa sledećom rečenicom.' },
  ]);
  assert.strictEqual(
    txt,
    'Danas ćemo pričati o veštačkoj inteligenciji.\nSada nastavljamo sa sledećom rečenicom.\n'
  );
});

test('Cyrillic text survives generation', () => {
  const txt = T.generateTxt([{ start: 0, end: 1, text: 'Данас ћемо причати.' }]);
  assert.strictEqual(txt, 'Данас ћемо причати.\n');
  const srt = T.generateSrt([{ start: 0, end: 1, text: 'Данас ћемо причати.' }]);
  assert.ok(srt.includes('Данас ћемо причати.'));
});

test('buildFileNames produces video-name.sr.srt and video-name.transcript.txt', () => {
  const n = T.buildFileNames('moj-video.mp4', 'sr');
  assert.strictEqual(n.srt, 'moj-video.sr.srt');
  assert.strictEqual(n.txt, 'moj-video.transcript.txt');
});

test('copyText exists with clipboard fallback', () => {
  assert.strictEqual(typeof T.copyText, 'function');
});
