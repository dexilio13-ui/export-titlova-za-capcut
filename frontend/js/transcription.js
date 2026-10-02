/**
 * Serbian Transcriber — transcription data utilities.
 *
 * Pure functions, no DOM access: SRT/TXT generation, time formatting,
 * copy helpers. Exposed as window.TranscriptionLib.
 */
(function () {
  "use strict";

  /** Pads a number to 2 digits. */
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** Pads a number to 3 digits. */
  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  /**
   * Converts seconds → "HH:MM:SS,mmm" (SRT uses a comma before milliseconds).
   * Non-finite input is clamped to 0 — we never invent timestamps, but we do
   * protect the file format from NaN slipping in.
   * @param {number} totalSeconds
   * @returns {string}
   */
  function secondsToSrtTime(totalSeconds) {
    const t = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
    const totalMs = Math.round(t * 1000);
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
  }

  /**
   * Converts seconds → "HH:MM:SS.mmm" for the on-screen viewer.
   * @param {number} totalSeconds
   * @returns {string}
   */
  function secondsToDisplayTime(totalSeconds) {
    return secondsToSrtTime(totalSeconds).replace(",", ".");
  }

  /**
   * Parses "HH:MM:SS,mmm" or "HH:MM:SS.mmm" back to seconds (SRT editor input).
   * Returns null when the input does not match the expected shape.
   * @param {string} str
   * @returns {number|null}
   */
  function srtTimeToSeconds(str) {
    if (typeof str !== "string") return null;
    const m = str.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const s = parseInt(m[3], 10);
    const ms = parseInt(m[4].padEnd(3, "0"), 10);
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  /**
   * Generates a standard SRT file content from segments.
   * Sequential numbering, "HH:MM:SS,mmm" timing, UTF-8 Serbian characters.
   * @param {Array<{start:number,end:number,text:string}>} segments
   * @returns {string}
   */
  function generateSrt(segments) {
    if (!Array.isArray(segments)) return "";
    const blocks = [];
    let n = 1;
    for (const seg of segments) {
      const text = (seg.text || "").trim();
      if (!text) continue;
      const start = secondsToSrtTime(seg.start);
      const end = secondsToSrtTime(Math.max(seg.end, seg.start));
      blocks.push(`${n}\n${start} --> ${end}\n${text}`);
      n += 1;
    }
    return blocks.join("\n\n") + (blocks.length ? "\n" : "");
  }

  /**
   * Generates clean plain text: transcription lines only — no numbers,
   * no timestamps, no SRT formatting. One source line per text line.
   * @param {Array<{text:string}>} segments
   * @returns {string}
   */
  function generateTxt(segments) {
    if (!Array.isArray(segments)) return "";
    const lines = segments
      .map((s) => (s.text || "").trim())
      .filter(Boolean);
    return lines.join("\n") + (lines.length ? "\n" : "");
  }

  /**
   * Triggers a browser download of a UTF-8 text file.
   * @param {string} content  file body
   * @param {string} filename e.g. "video.sr.srt"
   */
  function downloadTextFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Builds SRT / TXT filenames from the original video name:
   *   "moj-video.mp4" → "moj-video.sr.srt" / "moj-video.transcript.txt"
   * @param {string} videoName
   * @param {string} langCode language for the SRT middle tag
   */
  function buildFileNames(videoName, langCode) {
    const base = (videoName || "video").replace(/\.[^.]+$/, "").slice(0, 80) || "video";
    const lang = (langCode || "sr").toLowerCase();
    return {
      srt: `${base}.${lang}.srt`,
      txt: `${base}.transcript.txt`,
    };
  }

  /**
   * Copies text to the clipboard with a fallback for older browsers.
   * @param {string} text
   * @returns {Promise<boolean>} success
   */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      /* fall through to legacy path */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  window.TranscriptionLib = {
    secondsToSrtTime,
    secondsToDisplayTime,
    srtTimeToSeconds,
    generateSrt,
    generateTxt,
    downloadTextFile,
    buildFileNames,
    copyText,
  };
})();
