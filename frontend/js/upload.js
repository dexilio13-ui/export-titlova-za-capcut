/**
 * Serbian Transcriber — upload & API module.
 * Exposed as window.UploadLib.
 */
(function () {
  "use strict";

  const MB = 1024 * 1024;

  const ALLOWED_EXT = [".mp4", ".mov"];
  const ALLOWED_MIME = ["video/mp4", "video/quicktime", "video/x-m4v", "application/octet-stream"];

  function getApiBase() {
    const base = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "";
    return String(base).replace(/\/+$/, "");
  }

  /**
   * Client-side validation. Returns { ok: boolean, reason?: string, maxMB? }.
   * @param {File} file
   * @param {number} maxMB
   */
  function validateFile(file, maxMB) {
    if (!file) return { ok: false, reason: "no_file" };

    const name = (file.name || "").toLowerCase();
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";

    if (!ALLOWED_EXT.includes(ext)) return { ok: false, reason: "unsupported" };
    if (file.size === 0) return { ok: false, reason: "empty" };
    if (maxMB && file.size > maxMB * MB) {
      return { ok: false, reason: "too_large", maxMB: maxMB };
    }
    return { ok: true };
  }

  /** Maps a failure reason to a friendly, user-facing message. */
  function friendlyError(reason, maxMB) {
    switch (reason) {
      case "unsupported":
      case "mov_unavailable":
        return "Unsupported file. Please upload an MP4 or MOV video.";
      case "empty":
        return "The selected file is empty.";
      case "too_large":
        return "File is too large. The maximum allowed size is " + (maxMB || 25) + " MB.";
      case "no_file":
        return "No video file was selected.";
      case "network":
        return "Could not reach the server. Check your connection and the backend URL in js/config.js.";
      case "timeout":
        return "The server took too long to respond. Please try again.";
      case "server":
        return "Server error. Please try again later.";
      case "rate_limited":
        return "Server is busy. Please wait a moment and try again.";
      case "no_speech":
        return "No speech was detected in this video.";
      default:
        return "Transcription failed. Please check your video and try again.";
    }
  }

  /**
   * Uploads the video via XHR so we get upload progress events.
   * @param {File} file
   * @param {string} language selector value
   * @param {{onProgress?: function(number):void}} handlers
   * @returns {Promise<object>} normalized transcription JSON from the backend
   */
  function uploadVideo(file, language, handlers) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", getApiBase() + "/api/transcribe", true);
      xhr.responseType = "json";
      xhr.timeout = 10 * 60 * 1000; // long videos may take a while

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && handlers && typeof handlers.onProgress === "function") {
          handlers.onProgress(e.loaded / e.total);
        }
      };

      xhr.onload = function () {
        let body = xhr.response;
        if (!body && xhr.responseText) {
          try { body = JSON.parse(xhr.responseText); } catch (_) { body = null; }
        }

        if (xhr.status >= 200 && xhr.status < 300 && body && body.success) {
          resolve(body);
          return;
        }

        const code = body && body.code;
        const map = {
          FILE_TOO_LARGE: "too_large",
          UNSUPPORTED_TYPE: "unsupported",
          NO_FILE: "no_file",
          RATE_LIMITED: "rate_limited",
          NO_SPEECH: "no_speech",
          MOV_UNAVAILABLE: "mov_unavailable",
        };
        let reason = map[code] || (xhr.status === 0 ? "network" : xhr.status >= 500 ? "server" : "default");
        if (reason === "too_large" && body && body.maxFileSizeMB) {
          reason = "too_large";
        }
        const maxMB = (body && body.maxFileSizeMB) || 25;
        const err = new Error(friendlyError(reason, maxMB));
        err.reason = reason;
        reject(err);
      };

      xhr.onerror = function () {
        reject(new Error(friendlyError("network")));
      };
      xhr.ontimeout = function () {
        reject(new Error(friendlyError("timeout")));
      };

      const fd = new FormData();
      fd.append("video", file, file.name);
      fd.append("language", language || "sr");
      xhr.send(fd);
    });
  }

  /**
   * Fetches backend limits via /api/health (best effort).
   * @returns {Promise<object|null>}
   */
  async function fetchLimits() {
    try {
      const res = await fetch(getApiBase() + "/api/health");
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  window.UploadLib = {
    validateFile: validateFile,
    friendlyError: friendlyError,
    uploadVideo: uploadVideo,
    fetchLimits: fetchLimits,
    getApiBase: getApiBase,
  };
})();
