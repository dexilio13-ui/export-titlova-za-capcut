'use strict';

/**
 * End-to-end browser upload test.
 *
 * Drives a real Chrome instance through the Chrome DevTools Protocol: it
 * navigates to the deployed site, picks a local video through the real file
 * input (exactly like a user would), clicks "Transcribe video" and measures
 * every stage.
 *
 * Requires no dependencies — Node 20+ ships a global WebSocket client.
 *
 * Usage:  node tools/browser-upload-test.js [path/to/video.mp4] [siteUrl]
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FILE = path.resolve(process.argv[2] || 'ispravljeno.mp4');
const SITE = process.argv[3] || 'https://dexilio13-ui.github.io/export-titlova-za-capcut/';
const PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 15 * 60 * 1000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => (bytes / 1048576).toFixed(2) + ' MB';

function log(...a) {
  console.log(...a);
}

/* ── minimal CDP client ─────────────────────────────────────────────── */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg.method, msg.params));
      }
    });
  }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 60000);
    });
  }

  on(fn) {
    this.listeners.push(fn);
  }

  async eval(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(res.exceptionDetails.text));
    return res.result.value;
  }
}

async function fetchJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (_) {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome debugging endpoint never came up');
}

/* ── main ───────────────────────────────────────────────────────────── */

(async function main() {
  if (!fs.existsSync(FILE)) {
    console.error('Fajl ne postoji: ' + FILE);
    process.exit(1);
  }
  const size = fs.statSync(FILE).size;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glow-cdp-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profile,
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let exitCode = 0;
  try {
    const version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
    log('Chrome: ' + version['Browser'] + '\n');

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page');
    const cdp = await CDP.attach(page.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    log('Otvaram: ' + SITE);
    await cdp.send('Page.navigate', { url: SITE + '?cdp=' + Date.now() });
    await cdp.eval(
      `new Promise((res, rej) => {
        const t0 = Date.now();
        const t = setInterval(() => {
          if (window.UI && window.TranscriptionLib && document.getElementById('fileInput')) { clearInterval(t); res(true); }
          else if (Date.now() - t0 > 45000) { clearInterval(t); rej(new Error('app se nije učitao')); }
        }, 200);
      })`
    );
    log('Aplikacija učitana.\n');

    // Pick the file exactly like a user: through the real <input type="file">.
    const doc = await cdp.send('DOM.getDocument');
    const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
    await cdp.send('DOM.setFileInputFiles', { files: [FILE], nodeId: node.nodeId });
    await sleep(1500);

    const picked = await cdp.eval(`(function () {
      const s = window.__APP_STATE__;
      return {
        hasFile: !!(s && s.file),
        maxMB: s && s.maxMB,
        ffmpeg: s && s.movSupport,
        name: s && s.file && s.file.name,
        size: s && s.file && s.file.size,
        duration: s && s.videoDuration,
        startVisible: !document.getElementById('startBtn').hidden,
        limitNote: document.getElementById('limitNote').textContent
      };
    })()`);
    log('Fajl izabran kroz pravi file input:');
    log('  ime:        ' + picked.name);
    log('  veličina:   ' + mb(picked.size) + ' (limit frontend-a: ' + picked.maxMB + ' MB)');
    log('  limit na ekranu: "' + picked.limitNote + '"');
    log('  ffmpeg na serveru: ' + picked.ffmpeg);
    log('  dugme aktivno: ' + picked.startVisible + '\n');

    // Instrument the app so we can time each stage.
    await cdp.eval(`(function () {
      const ui = window.UI;
      const probe = { t0: performance.now(), indeterminateAt: null, steps: [] };
      window.__probe = probe;
      const origStep = ui.setStep;
      ui.setStep = function (k) { probe.steps.push({ step: k, at: Math.round(performance.now() - probe.t0) }); return origStep.call(ui, k); };
      const origInd = ui.setIndeterminate;
      ui.setIndeterminate = function (on) {
        if (on && probe.indeterminateAt === null) probe.indeterminateAt = Math.round(performance.now() - probe.t0);
        return origInd.call(ui, on);
      };
      probe.t0 = performance.now();
      return true;
    })()`);

    const t0 = Date.now();
    log('Klikćem "Transcribe video" …');
    await cdp.eval(`document.getElementById('startBtn').click(); true`);

    let done = false;
    let result = null;
    while (Date.now() - t0 < TIMEOUT_MS) {
      await sleep(500);
      result = await cdp.eval(`(function () {
        const s = window.__APP_STATE__;
        const probe = window.__probe;
        return {
          steps: probe.steps,
          indeterminateAt: probe.indeterminateAt,
          error: document.getElementById('errorBox').hidden ? null : document.getElementById('errorMessage').textContent,
          resultsShown: !document.getElementById('resultsSection').hidden,
          meta: document.getElementById('metaLine').textContent,
          pct: document.getElementById('progressPct').textContent,
          status: document.getElementById('statusText').textContent,
          segments: s.result ? s.result.segments.length : 0,
          words: s.result && s.result.words ? s.result.words.length : 0,
          converted: s.result ? s.result.converted : null,
          duration: s.result ? s.result.duration : null,
          lang: s.result ? s.result.language : null
        };
      })()`);
      if (result.error || result.resultsShown) {
        done = true;
        break;
      }
    }

    const totalMs = Date.now() - t0;
    const uploadMs = result.indeterminateAt;

    log('\n═══ REZULTATI ═══');
    if (!done) {
      log('⏱  Test nije završen za ' + TIMEOUT_MS / 1000 + ' s (status: "' + result.status + '")');
      exitCode = 1;
    }
    log('Fajl:            ' + path.basename(FILE) + ' · ' + mb(size));
    if (Number.isFinite(uploadMs)) {
      log('Upload:          ' + (uploadMs / 1000).toFixed(2) + ' s  →  ' +
          (size / 1048576 / (uploadMs / 1000)).toFixed(2) + ' MB/s');
    } else {
      log('Upload:          (nije zabeležen završetak uploada)');
    }
    if (done && result.resultsShown) {
      log('Obrada servera:  ' + ((totalMs - (uploadMs || 0)) / 1000).toFixed(2) + ' s');
      log('UKUPNO:          ' + (totalMs / 1000).toFixed(2) + ' s');
      log('Rezultat:        ' + result.segments + ' linija · ' + result.words + ' reč sa vremenima · jezik ' + result.lang);
      log('Trajanje videa:  ' + (result.duration ? result.duration.toFixed(2) + ' s' : 'nepoznato'));
      log('Audio izdvojeno: ' + (result.converted ? 'da (ffmpeg)' : 'ne (poslat direktno)'));
      log('Meta linija:     ' + result.meta);

      const srt = await cdp.eval(`(function () {
        const lib = window.TranscriptionLib;
        const segs = window.__APP_STATE__.result.segments.map(function (s) { return { start: s.start, end: s.end, text: s.text }; });
        const out = lib.generateSrt(segs);
        return { length: out.length, head: out.split('\\n').slice(0, 4).join(' / '), lines: out.split('\\n').filter(Boolean).length };
      })()`);
      log('\nSRT izlaz: ' + srt.length + ' karaktera, ' + srt.lines + ' redova');
      log('  ' + srt.head);
      log('\nKoraci (ms od klika):');
      result.steps.forEach((s) => log('  ' + String(s.at).padStart(7) + ' ms  ' + s.step));
    } else if (result.error) {
      log('GREŠKA od servera: ' + result.error);
      exitCode = 1;
    }
  } catch (err) {
    console.error('Test nije mogao da se pokrene: ' + err.message);
    exitCode = 1;
  } finally {
    chrome.kill();
  }
  process.exit(exitCode);
})();