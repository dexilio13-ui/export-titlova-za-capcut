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
      case "upload_interrupted":
        return "The connection dropped during upload. Press \"Try again\" — nothing was saved.";
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
   * Did the upload die part-way (connection drop) or before it even started?
   * Pure function so the behaviour is unit tested.
   * @param {number} fractionSent 0..1 bytes already uploaded
   * @param {boolean} exhausted retries already used
   * @returns {string} error reason
   */
  function classifyNetworkFailure(fractionSent, exhausted) {
    // Bytes were already moving: the server URL is fine, the link broke.
    if (fractionSent > 0.01 || exhausted) return "upload_interrupted";
    return "network";
  }

  /** Backoff before retrying an upload: 1s, then 3s. */
  function retryDelay(attempt) {
    return attempt <= 1 ? 1000 : 3000;
  }

  /**
   * Uploads the video via XHR so we get upload progress events.
   *
   * Free-tier hosts recycle instances and home networks drop connections, so
   * a single dropped upload is retried automatically before giving up.
   *
   * @param {File} file
   * @param {string} language selector value
   * @param {{onProgress?: function(number):void, onRetry?: function(number):void}} handlers
   * @param {number} [attempt] internal
   * @returns {Promise<object>} normalized transcription JSON from the backend
   */
  function uploadVideo(file, language, handlers, attempt) {
    attempt = attempt || 1;
    const MAX_ATTEMPTS = 2;
    let sent = 0;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", getApiBase() + "/api/transcribe", true);
      xhr.responseType = "json";
      xhr.timeout = 10 * 60 * 1000; // long videos may take a while

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          sent = e.loaded / e.total;
          if (handlers && typeof handlers.onProgress === "function") handlers.onProgress(sent);
        }
      };

      function retryOrFail() {
        const exhausted = attempt >= MAX_ATTEMPTS;
        if (!exhausted && classifyNetworkFailure(sent, false) === "upload_interrupted") {
          if (handlers && typeof handlers.onRetry === "function") handlers.onRetry(attempt);
          setTimeout(function () {
            uploadVideo(file, language, handlers, attempt + 1).then(resolve, reject);
          }, retryDelay(attempt));
          return;
        }
        const reason = classifyNetworkFailure(sent, exhausted);
        const err = new Error(friendlyError(reason));
        err.reason = reason;
        reject(err);
      }

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
        const reason = map[code] || (xhr.status === 0 ? "network" : xhr.status >= 500 ? "server" : "default");
        const maxMB = (body && body.maxUploadMB) || (body && body.maxFileSizeMB) || 25;
        const err = new Error(friendlyError(reason, maxMB));
        err.reason = reason;
        reject(err);
      };

      xhr.onerror = retryOrFail;
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
    classifyNetworkFailure: classifyNetworkFailure,
    retryDelay: retryDelay,
    uploadVideo: uploadVideo,
    fetchLimits: fetchLimits,
    getApiBase: getApiBase,
  };
})();
