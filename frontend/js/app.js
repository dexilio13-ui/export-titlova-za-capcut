/**
 * Serbian Transcriber — app controller.
 * Wires UI + UploadLib + TranscriptionLib together. No secrets here.
 */
(function () {
  "use strict";

  const T = window.TranscriptionLib;
  const UI = window.UI;

  /** Application state (kept in memory only). */
  const state = {
    file: null,
    videoDuration: null,
    maxMB: 25,
    movSupport: null,
    language: "sr",
    result: null, // { filename, language, segments: [{id,start,end,text}], words: [] }
    edited: false,
    showTimestamps: true,
  };

  /* ── Boot ──────────────────────────────────────────────────────────── */

  document.addEventListener("DOMContentLoaded", function () {
    UI.init();
    bindUploadEvents();
    bindResultEvents();
    refreshLimits();
  });

  function refreshLimits() {
    UploadLib.fetchLimits().then(function (info) {
      if (!info) {
        UI.elements.limitNote.textContent =
          "Backend offline — set API_BASE_URL in js/config.js";
        return;
      }
      if (info.maxFileSizeMB) {
        state.maxMB = info.maxUploadMB || info.maxFileSizeMB;
        const ffmpeg = info.ffmpeg !== false && info.movSupport !== false;
        state.movSupport = ffmpeg;
        UI.elements.limitNote.textContent = ffmpeg
          ? "MP4 ili MOV · do " + (info.maxUploadMB || info.maxFileSizeMB) +
            " MB · zvuk se izdvaja automatski"
          : "Max file size: " + info.maxFileSizeMB + " MB · MP4 only";
      } else {
        state.movSupport = info.movSupport;
      }
    });
  }

  /* ── Upload flow ───────────────────────────────────────────────────── */

  function bindUploadEvents() {
    const dz = UI.elements.dropzone;
    const input = UI.elements.fileInput;

    UI.elements.chooseBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      input.click();
    });

    // Keyboard support for the dropzone pseudo-button.
    dz.addEventListener("click", function () {
      input.click();
    });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
        return;
      }
    });

    ["dragenter", "dragover"].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove("dragging");
      });
    });
    dz.addEventListener("drop", function (e) {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) selectFile(files[0]);
    });

    input.addEventListener("change", function () {
      if (input.files && input.files.length) selectFile(input.files[0]);
    });

    UI.elements.clearFileBtn.addEventListener("click", function () {
      resetUpload();
    });

    UI.elements.startBtn.addEventListener("click", startTranscription);
    UI.elements.dismissErrorBtn.addEventListener("click", UI.hideError);
    UI.elements.languageSelect.addEventListener("change", function () {
      state.language = UI.elements.languageSelect.value;
    });
  }

  /** Client-side selection: validate → preview → enable the CTA. */
  function selectFile(file) {
    UI.hideError();

    const v = UploadLib.validateFile(file, state.maxMB);
    if (!v.ok) {
      UI.showError("Upload blocked", UploadLib.friendlyError(v.reason, v.maxMB));
      return;
    }

    state.file = file;
    state.videoDuration = null;

    UI.showFileInfo(file, null);
    UI.showVideoPreview(file);

    // Read duration from the preview element when metadata arrives.
    const vp = UI.elements.videoPreview;
    vp.onloadedmetadata = function () {
      state.videoDuration = vp.duration;
      UI.showFileInfo(file, vp.duration);
    };
    vp.onerror = function () {
      /* some containers don't preview; not fatal */
    };

    UI.elements.startBtn.hidden = false;
    UI.elements.startBtn.disabled = false;
    UI.elements.startBtn.textContent = "Transcribe video";
  }

  function resetUpload() {
    state.file = null;
    state.videoDuration = null;
    UI.elements.fileInput.value = "";
    UI.hideFileInfo();
    UI.hideError();
    UI.showProgress(false);
    UI.elements.startBtn.hidden = true;
    UI.elements.startBtn.disabled = true;
  }

  async function startTranscription() {
    if (!state.file) return;
    const file = state.file;

    UI.hideError();
    UI.elements.startBtn.disabled = true;
    UI.showProgress(true);
    UI.setStep("uploading");
    UI.setProgress(0);

    try {
      const result = await UploadLib.uploadVideo(file, state.language, {
        onProgress: function (fraction) {
          // Map the real upload to 0–45% of the whole pipeline.
          UI.setProgress(Math.min(45, fraction * 45));
          if (fraction >= 1) {
            UI.setStep("preparing");
            UI.setIndeterminate(true);
          }
        },
        onPhase: null,
      });

      UI.setStep("transcribing");
      UI.setIndeterminate(true);
      UI.setStep("subtitles");
      UI.setStep("done");
      UI.setProgress(100);

      state.result = result;
      state.edited = false;

      if (!result.segments || result.segments.length === 0) {
        UI.showProgress(false);
        UI.showError("Nothing transcribed", UploadLib.friendlyError("no_speech"));
        UI.elements.startBtn.disabled = false;
        UI.elements.startBtn.textContent = "Try again";
        return;
      }

      renderResults();
      UI.showToast("Transcription complete ✓");
    } catch (err) {
      UI.showProgress(false);
      UI.setStep(null);
      UI.showError("Something went wrong", (err && err.message) || "Please try again.");
      UI.elements.startBtn.disabled = false;
      UI.elements.startBtn.textContent = "Try again";
    }
  }

  /* ── Results ───────────────────────────────────────────────────────── */

  function bindResultEvents() {
    UI.elements.downloadSrtBtn.addEventListener("click", function () {
      if (!state.result) return;
      const segs = currentSegments();
      const names = T.buildFileNames(state.result.filename, srtLangTag(state.result.language));
      T.downloadTextFile(T.generateSrt(segs), names.srt);
      UI.showToast("SRT downloaded ✓");
    });

    UI.elements.downloadTxtBtn.addEventListener("click", function () {
      if (!state.result) return;
      const names = T.buildFileNames(state.result.filename, srtLangTag(state.result.language));
      T.downloadTextFile(T.generateTxt(currentSegments()), names.txt);
      UI.showToast("TXT downloaded ✓");
    });

    UI.elements.copyAllBtn.addEventListener("click", async function () {
      if (!state.result) return;
      const ok = await T.copyText(T.generateTxt(currentSegments()));
      UI.showToast(ok ? "All text copied ✓" : "Copy failed — select and copy manually");
    });

    UI.elements.newVideoBtn.addEventListener("click", function () {
      state.result = null;
      UI.clearTranscript();
      UI.elements.resultsSection.hidden = true;
      resetUpload();
      UI.elements.startBtn.hidden = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    UI.elements.timestampsToggle.addEventListener("change", function () {
      state.showTimestamps = UI.elements.timestampsToggle.checked;
      renderResults();
    });
  }

  /** Server language ("sr" / "srp") → two-letter SRT filename tag. */
  function srtLangTag(lang) {
    const l = String(lang || "sr").toLowerCase();
    return l.slice(0, 2) || "sr";
  }

  /** Returns the segments as currently shown (edits included). */
  function currentSegments() {
    if (!state.result || !Array.isArray(state.result.segments)) return [];
    return state.result.segments.map(function (s) {
      return { start: s.start, end: s.end, text: s.text };
    });
  }

  function renderResults() {
    if (!state.result) return;
    const T2 = window.TranscriptionLib;
    const list = UI.elements.transcript;
    UI.clearTranscript();

    state.result.segments.forEach(function (seg, i) {
      const el = UI.createLineElement({
        index: i,
        segment: seg,
        onCopy: async function (idx, btn) {
          const ok = await T2.copyText(state.result.segments[idx].text);
          if (ok) {
            btn.textContent = "Copied!";
            setTimeout(function () {
              btn.textContent = "Copy";
            }, 1200);
          } else {
            UI.showToast("Copy failed — select the text and copy manually");
          }
        },
        onEditSave: function (idx, patch) {
          const seg = state.result.segments[idx];
          seg.text = (patch.text || "").trim() || seg.text;
          if (patch.startChanged) seg.start = patch.start;
          if (patch.endChanged) seg.end = patch.end;
          state.edited = true;
          renderResults();
          UI.showToast("Line updated — SRT/TXT will use the edited text");
        },
      });
      list.appendChild(el);
    });

    const wordsCount = state.result.words && state.result.words.length > 0 ? state.result.words.length : 0;
    UI.elements.metaLine.textContent =
      state.result.segments.length + " segments · " +
      (wordsCount > 0 ? wordsCount + " word timestamps kept" : "segment timestamps only") +
      (state.edited ? " · edited" : "");

    UI.elements.resultsSection.hidden = false;
    UI.elements.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Expose for tests/debugging (no secrets involved).
  window.__APP_STATE__ = state;
})();
