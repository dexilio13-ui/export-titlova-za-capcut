/**
 * Serbian Transcriber — UI layer (DOM helpers, progress, toast, glow).
 * Exposed as window.UI.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {};

  function cacheEls() {
    Object.assign(els, {
      dropzone: $("dropzone"),
      chooseBtn: $("chooseBtn"),
      fileInput: $("fileInput"),
      fileInfo: $("fileInfo"),
      fileName: $("fileName"),
      fileSize: $("fileSize"),
      fileDuration: $("fileDuration"),
      videoPreview: $("videoPreview"),
      clearFileBtn: $("clearFileBtn"),
      progressArea: $("progressArea"),
      statusText: $("statusText"),
      progressBar: $("progressBar"),
      progressFill: $("progressFill"),
      progressPct: $("progressPct"),
      stepsList: $("stepsList"),
      errorBox: $("errorBox"),
      errorTitle: $("errorTitle"),
      errorMessage: $("errorMessage"),
      dismissErrorBtn: $("dismissErrorBtn"),
      startBtn: $("startBtn"),
      languageSelect: $("languageSelect"),
      limitNote: $("limitNote"),
      resultsSection: $("resultsSection"),
      downloadSrtBtn: $("downloadSrtBtn"),
      downloadTxtBtn: $("downloadTxtBtn"),
      copyAllBtn: $("copyAllBtn"),
      newVideoBtn: $("newVideoBtn"),
      timestampsToggle: $("timestampsToggle"),
      metaLine: $("metaLine"),
      transcript: $("transcript"),
      toast: $("toast"),
      mouseGlow: $("mouseGlow"),
    });
  }

  /* ── Status & progress ─────────────────────────────────────────────── */

  const STEP_ORDER = ["uploading", "preparing", "transcribing", "subtitles", "done"];

  const STEP_LABELS = {
    uploading: "Uploading video…",
    preparing: "Preparing audio…",
    transcribing: "Transcribing Serbian speech…",
    subtitles: "Creating subtitles…",
    done: "Done ✓",
  };

  function setStep(stepKey) {
    if (!els.stepsList) return;
    const idx = STEP_ORDER.indexOf(stepKey);
    const items = els.stepsList.querySelectorAll("li");
    items.forEach((li, i) => {
      const isDone = stepKey === "done" || (idx >= 0 && i < idx);
      li.classList.toggle("active", i === idx);
      li.classList.toggle("done", isDone);
    });
    if (els.statusText) els.statusText.textContent = STEP_LABELS[stepKey] || "";
  }

  function setProgress(pct) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (els.progressFill) {
      els.progressFill.classList.remove("indeterminate");
      els.progressFill.style.width = clamped + "%";
    }
    if (els.progressBar) els.progressBar.setAttribute("aria-valuenow", String(clamped));
    if (els.progressPct) els.progressPct.textContent = clamped + "%";
  }

  function setIndeterminate(on) {
    if (!els.progressFill) return;
    els.progressFill.classList.toggle("indeterminate", Boolean(on));
    if (on) {
      if (els.progressPct) els.progressPct.textContent = "working…";
      if (els.progressBar) els.progressBar.removeAttribute("aria-valuenow");
    }
  }

  function showProgress(show) {
    if (els.progressArea) els.progressArea.hidden = !show;
  }

  /* ── Error box ─────────────────────────────────────────────────────── */

  function showError(title, message) {
    if (!els.errorBox) return;
    els.errorBox.hidden = false;
    if (els.errorTitle) els.errorTitle.textContent = title || "Something went wrong";
    if (els.errorMessage) els.errorMessage.textContent = message || "Please try again.";
  }

  function hideError() {
    if (els.errorBox) els.errorBox.hidden = true;
  }

  /* ── Toast ─────────────────────────────────────────────────────────── */

  let toastTimer = null;
  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    requestAnimationFrame(() => els.toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
      setTimeout(() => {
        if (els.toast) els.toast.hidden = true;
      }, 300);
    }, 1800);
  }

  /* ── File info & preview ───────────────────────────────────────────── */

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function showFileInfo(file, duration) {
    if (!els.fileInfo) return;
    els.fileInfo.hidden = false;
    if (els.fileName) els.fileName.textContent = file.name;
    if (els.fileSize) els.fileSize.textContent = formatBytes(file.size);
    if (Number.isFinite(duration) && duration > 0) {
      const m = Math.floor(duration / 60);
      const s = Math.round(duration % 60);
      if (els.fileDuration) {
        els.fileDuration.hidden = false;
        els.fileDuration.textContent = `· ${m}:${String(s).padStart(2, "0")} min`;
      }
    } else if (els.fileDuration) {
      els.fileDuration.hidden = true;
    }
  }

  function hideFileInfo() {
    if (!els.fileInfo) return;
    els.fileInfo.hidden = true;
    if (els.videoPreview) {
      els.videoPreview.hidden = true;
      els.videoPreview.removeAttribute("src");
      els.videoPreview.load();
    }
    if (els.fileDuration) els.fileDuration.hidden = true;
  }

  function showVideoPreview(file) {
    if (!els.videoPreview) return;
    els.videoPreview.hidden = false;
    els.videoPreview.src = URL.createObjectURL(file);
  }

  /* ── Transcript rendering ──────────────────────────────────────────── */

  function clearTranscript() {
    if (els.transcript) els.transcript.innerHTML = "";
  }

  function buildEditor(index, segment, onEditSave) {
    const T = window.TranscriptionLib;

    const editor = document.createElement("div");
    editor.className = "line-editor";

    // Text field
    const lblText = document.createElement("label");
    lblText.htmlFor = `edit-text-${index}`;
    lblText.textContent = "Text";
    const ta = document.createElement("textarea");
    ta.id = `edit-text-${index}`;
    ta.value = segment.text;

    // Start / End fields
    const row = document.createElement("div");
    row.className = "edit-row";

    const fieldStart = document.createElement("div");
    const lblStart = document.createElement("label");
    lblStart.htmlFor = `edit-start-${index}`;
    lblStart.textContent = "Start (HH:MM:SS,mmm)";
    const inStart = document.createElement("input");
    inStart.id = `edit-start-${index}`;
    inStart.value = T.secondsToSrtTime(segment.start);
    inStart.setAttribute("inputmode", "numeric");
    fieldStart.appendChild(lblStart);
    fieldStart.appendChild(inStart);

    const fieldEnd = document.createElement("div");
    const lblEnd = document.createElement("label");
    lblEnd.htmlFor = `edit-end-${index}`;
    lblEnd.textContent = "End (HH:MM:SS,mmm)";
    const inEnd = document.createElement("input");
    inEnd.id = `edit-end-${index}`;
    inEnd.value = T.secondsToSrtTime(segment.end);
    inEnd.setAttribute("inputmode", "numeric");
    fieldEnd.appendChild(lblEnd);
    fieldEnd.appendChild(inEnd);

    row.appendChild(fieldStart);
    row.appendChild(fieldEnd);

    // Actions
    const acts = document.createElement("div");
    acts.className = "edit-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn btn-primary";
    save.textContent = "Save changes";

    save.addEventListener("click", () => {
      const newStart = T.srtTimeToSeconds(inStart.value);
      const newEnd = T.srtTimeToSeconds(inEnd.value);
      // Only pass timestamp changes when the user actually edited them.
      onEditSave(index, {
        text: ta.value,
        start: newStart === null ? segment.start : newStart,
        startChanged: newStart !== null && newStart !== segment.start,
        end: newEnd === null ? segment.end : newEnd,
        endChanged: newEnd !== null && newEnd !== segment.end,
      });
    });

    acts.appendChild(save);
    editor.appendChild(lblText);
    editor.appendChild(ta);
    editor.appendChild(row);
    editor.appendChild(acts);
    return editor;
  }

  /**
   * Renders one segment row: number, timestamp, text, Copy + Edit buttons,
   * and an inline editor (text / start / end + Save changes).
   */
  function createLineElement({ index, segment, onCopy, onEditSave }) {
    const T = window.TranscriptionLib;

    const card = document.createElement("article");
    card.className = "line-card";
    card.setAttribute("role", "listitem");

    const top = document.createElement("div");
    top.className = "line-top";

    const num = document.createElement("span");
    num.className = "line-num";
    num.textContent = String(index + 1).padStart(3, "0");

    const time = document.createElement("span");
    time.className = "line-time";
    time.textContent = `${T.secondsToDisplayTime(segment.start)} → ${T.secondsToDisplayTime(segment.end)}`;

    top.appendChild(num);
    top.appendChild(time);

    const p = document.createElement("p");
    p.className = "line-text";
    p.textContent = segment.text;

    const actions = document.createElement("div");
    actions.className = "line-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn";
    copyBtn.textContent = "Copy";
    copyBtn.setAttribute("aria-label", `Copy line ${index + 1}`);
    copyBtn.addEventListener("click", () => onCopy(index, copyBtn));

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn";
    editBtn.textContent = "Edit text";
    editBtn.setAttribute("aria-expanded", "false");
    editBtn.setAttribute("aria-controls", `edit-${index}`);
    editBtn.addEventListener("click", () => {
      const existing = card.querySelector(".line-editor");
      if (existing) {
        existing.remove();
        editBtn.setAttribute("aria-expanded", "false");
        editBtn.textContent = "Edit text";
        return;
      }
      const editor = buildEditor(index, segment, onEditSave);
      editor.id = `edit-${index}`;
      card.appendChild(editor);
      editBtn.setAttribute("aria-expanded", "true");
      editBtn.textContent = "Close editor";
      const ta = editor.querySelector("textarea");
      if (ta) ta.focus();
    });

    actions.appendChild(copyBtn);
    actions.appendChild(editBtn);
    card.appendChild(top);
    card.appendChild(p);
    card.appendChild(actions);
    return card;
  }

  /* ── Mouse-following glow (one tiny rAF-throttled handler) ─────────── */

  function initMouseGlow() {
    if (!els.mouseGlow) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let tx = innerWidth / 2;
    let ty = innerHeight / 3;
    let x = tx;
    let y = ty;
    let raf = null;

    addEventListener("pointermove", (e) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          x += (tx - x) * 0.08;
          y += (ty - y) * 0.08;
          els.mouseGlow.style.transform = `translate(${x - 260}px, ${y - 260}px)`;
          raf = null;
        });
      }
    }, { passive: true });
  }

  /* ── Init ──────────────────────────────────────────────────────────── */

  function init() {
    cacheEls();
    initMouseGlow();
  }

  window.UI = {
    init,
    setStep,
    setProgress,
    setIndeterminate,
    showProgress,
    showError,
    hideError,
    showToast,
    formatBytes,
    showFileInfo,
    hideFileInfo,
    showVideoPreview,
    clearTranscript,
    createLineElement,
    elements: els,
  };
})();
