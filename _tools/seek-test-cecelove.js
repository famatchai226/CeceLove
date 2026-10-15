/* End-to-end seek test for the CeceLove trailer.

   Starts a local static server (with HTTP Range support, like Vercel/Cloudflare),
   drives headless Chrome over the DevTools Protocol, loads the REAL landing page,
   and scrubs the real <video> element — first while paused, then while playing.

   Usage: node _seek_test_cecelove.js ["path\\to\\chrome.exe"]
   Exit code 0 = all seeks landed, 1 = problem. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CHROME = process.argv.slice(2).find(a => !a.startsWith('--'))
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/* locate the landing page root, whether this script sits inside it (…/_tools/) or next to it */
function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'locales'))) return dir;
    const candidate = path.join(dir, 'cecelove-landing-page');
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('cecelove-landing-page folder not found near ' + start);
}
const ROOT = findRoot(__dirname);
const HTTP_PORT = 8788;
const CDP_PORT = 9333;
const PAGE_URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.woff2': 'font/woff2'
};

const stats = { requests: 0, rangeRequests: 0, bytes: 0, videoBytes: 0 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Global token bucket so concurrent range requests share one bandwidth budget.
   Throttling is what makes this test realistic: on a slow connection, a trailer
   WITHOUT faststart (moov at the END of the file) cannot be seeked at all until
   the whole file has been downloaded. */
const KBPS = parseInt((process.argv.find(a => a.startsWith('--throttle=')) || '--throttle=1200')
  .split('=')[1], 10) || 1200;
const RATE = KBPS * 1024;
let tokens = RATE, lastRefill = Date.now();
function throttleWait(bytes) {
  const now = Date.now();
  tokens = Math.min(RATE, tokens + (now - lastRefill) * RATE / 1000);
  lastRefill = now;
  tokens -= bytes;
  return tokens >= 0 ? 0 : Math.round(-tokens / RATE * 1000);
}

/* ---------- 1. static server with Range support ---------- */
const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('404');
  }
  const st = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const isVideo = type === 'video/mp4';
  const count = d => { stats.bytes += d.length; if (isVideo) stats.videoBytes += d.length; };

  stats.requests++;
  const range = req.headers.range;
  let start = 0, end = st.size - 1, status = 200;
  if (range) {
    stats.rangeRequests++;
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    start = m && m[1] ? parseInt(m[1], 10) : 0;
    end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (end >= st.size) end = st.size - 1;
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
      return res.end();
    }
    status = 206;
  }
  const headers = {
    'Content-Type': type, 'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1
  };
  if (status === 206) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
  res.writeHead(status, headers);

  const s = fs.createReadStream(file, { start, end, highWaterMark: 64 * 1024 });
  let closed = false;
  req.on('close', () => { closed = true; });
  try {
    for await (const chunk of s) {
      if (closed || res.destroyed) { s.destroy(); return; }
      count(chunk);
      const waitMs = throttleWait(chunk.length);
      if (waitMs) await sleep(waitMs);
      if (closed || res.destroyed) { s.destroy(); return; }
      if (!res.write(chunk)) await new Promise(r => res.once('drain', r));
    }
    res.end();
  } catch (e) {
    try { res.end(); } catch (e2) {}
  }
});

/* ---------- 2. minimal DevTools Protocol client (Node's built-in WebSocket) ---------- */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('websocket error')));
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        return new Promise((res, rej) => {
          pending.set(mid, { resolve: res, reject: rej });
          setTimeout(() => {
            if (pending.has(mid)) { pending.delete(mid); rej(new Error(method + ' timed out')); }
          }, 120000);
        });
      },
      close() { try { ws.close(); } catch (e) {} }
    }));
  });
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

function reportStats() {
  const video = path.join(ROOT, 'assets', 'trailer.mp4');
  const fileSize = fs.existsSync(video) ? fs.statSync(video).size : 0;
  const pct = fileSize ? (100 * stats.videoBytes / fileSize).toFixed(1) : '0';
  console.log('');
  console.log('HTTP requests     : ' + stats.requests + ' (' + stats.rangeRequests + ' range requests)');
  console.log('trailer bytes sent: ' + stats.videoBytes + ' / ' + fileSize
    + ' bytes (' + pct + '% of the file)');
  return { fileSize, pct: parseFloat(pct) };
}

(async () => {
  let chrome = null, cdp = null, exitCode = 1;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cecelove-seek-'));

  try {
    await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
    console.log('server      : ' + PAGE_URL + '  (root ' + ROOT + ', throttled to ' + KBPS + ' KB/s)');

    chrome = spawn(CHROME, [
      '--headless=new',
      '--remote-debugging-port=' + CDP_PORT,
      '--remote-allow-origins=*',
      '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-sync', '--disable-translate',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio', '--window-size=1280,900',
      'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.stderr.on('data', () => {});
    chrome.on('error', e => { console.error('chrome failed to start: ' + e.message); });

    let version = null;
    for (let i = 0; i < 60 && !version; i++) {
      try { version = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); }
      catch (e) { await sleep(500); }
    }
    if (!version) throw new Error('Chrome DevTools endpoint never came up');
    console.log('chrome      : ' + version.Browser);

    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      const list = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list');
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('no page target found');

    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    cdp.send('Page.navigate', { url: PAGE_URL }).catch(() => {});

    /* helpers driven through the real browser input pipeline */
    const evaluate = async expr => (await cdp.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true
    })).result.value;
    const clickAt = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await sleep(200);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
      await sleep(60);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
      await sleep(500);
    };

    /* wait until the landing page has delivered a usable <video> */
    const readyExpr = `new Promise(r => {
      const t0 = Date.now();
      (function poll() {
        const v = document.querySelector('video');
        if (v && v.readyState >= 1) return r({ ok: true, readyState: v.readyState, duration: v.duration });
        if (Date.now() - t0 > 30000) return r({ ok: false, readyState: v ? v.readyState : -1,
          error: v && v.error ? v.error.code : null });
        setTimeout(poll, 250);
      })();
    })`;
    const ready = await cdp.send('Runtime.evaluate', {
      expression: readyExpr, awaitPromise: true, returnByValue: true
    });
    console.log('video ready : ' + JSON.stringify(ready.result.value));
    if (!ready.result.value || !ready.result.value.ok) throw new Error('video never became seekable');

    /* ---------- dismiss the 18+ age gate the way a real visitor does ----------
       (poll first: the video element exists well before the gate markup is parsed) */
    let gateBtn = null;
    for (let i = 0; i < 40 && !gateBtn; i++) {
      const probe = await evaluate(`(() => {
        const gate = document.getElementById('ageGate');
        if (!gate) return null;
        if (gate.hasAttribute('hidden')) return { already: true };
        const b = document.getElementById('ageGateYes');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
                 label: b.textContent.trim() };
      })()`);
      if (probe) gateBtn = probe; else await sleep(250);
    }
    if (!gateBtn) throw new Error('the 18+ age gate never appeared in the DOM');
    if (gateBtn.error) throw new Error('age gate: ' + gateBtn.error);
    if (gateBtn.already) {
      console.log('age gate    : already dismissed');
    } else {
      await clickAt(gateBtn.x, gateBtn.y);
      const closed = await evaluate(`(() => {
        const gate = document.getElementById('ageGate');
        return { hidden: gate.hasAttribute('hidden'),
                 display: getComputedStyle(gate).display,
                 bodyOverflow: document.body.style.overflow };
      })()`);
      console.log('age gate    : clicked "' + gateBtn.label + '" -> hidden=' + closed.hidden
        + ' display=' + closed.display + ' bodyOverflow="' + closed.bodyOverflow + '"');
      if (!closed.hidden || closed.display !== 'none') {
        throw new Error('the 18+ age gate did not close when its button was clicked');
      }
      if (closed.bodyOverflow === 'hidden') {
        console.log('WARNING     : body overflow is still locked to hidden after closing the gate (page cannot scroll)');
      }
      await sleep(400);
    }


    /* run the in-page probe */
    const probeSrc = fs.readFileSync(path.join(__dirname, 'seek-probe.js'), 'utf8');
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: '(' + probeSrc + ')()',
      awaitPromise: true,
      returnByValue: true
    });
    const out = evalRes.result.value;
    if (!out) throw new Error('probe returned nothing: ' + JSON.stringify(evalRes.result));

    /* ---------- report ---------- */
    console.log('');
    console.log('source            : ' + out.src);
    console.log('preload/controls  : ' + out.preload + ' / ' + out.controls);
    console.log('H.264 supported   : ' + out.h264Supported);
    console.log('duration          : ' + out.duration + 's');
    console.log('seekable end      : ' + out.afterMetadata.seekableEnd + 's '
      + (out.afterMetadata.seekableEnd >= out.duration - 0.01
        ? '(whole timeline, available before the file is downloaded)' : '(PARTIAL!)'));
    console.log('buffered @ meta   : ' + out.afterMetadata.bufferedEnd + 's of ' + out.duration + 's');
    console.log('');

    const problems = [];
    console.log('seeks:');
    out.steps.forEach(s => {
      const ok = s.delta <= 0.6;
      if (!ok) problems.push(s.mode + ' seek to ' + s.target + 's landed at ' + s.landed + 's');
      console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + s.mode.padEnd(8) +
        ' -> ' + String(s.target).padStart(7) + 's  landed ' + String(s.landed).padStart(7) +
        's  (delta ' + s.delta + 's, ' + s.ms + ' ms, readyState ' + s.readyState + ')');
    });
    if (out.steps.length < 6) problems.push('only ' + out.steps.length + ' of 6 seeks completed');
    out.errors.forEach(e => problems.push('error: ' + e));

    if (out.playingBefore && out.playingAfter) {
      const advanced = out.playingAfter.currentTime > out.playingBefore.currentTime - 0.05;
      console.log('');
      console.log('playback before seek @' + out.playingBefore.currentTime + 's paused=' + out.playingBefore.paused);
      console.log('playback after  seek @' + out.playingAfter.currentTime + 's paused=' + out.playingAfter.paused
        + '  -> ' + (advanced ? 'PASS keeps playing' : 'FAIL stalled after seek'));
      if (!advanced) problems.push('playback stalled after the mid-playback seek');
      if (out.playingAfter.paused) problems.push('video paused itself after the seek');
    }

    /* ---------- 3. real UI check: is the progress bar clickable, and does a
                    real mouse click scrub the video while it plays? ---------- */
    const uiSrc = fs.readFileSync(path.join(__dirname, 'scrub-probe.js'), 'utf8');
    const ui = (await cdp.send('Runtime.evaluate', {
      expression: '(' + uiSrc + ')()', awaitPromise: true, returnByValue: true
    })).result.value;
    if (ui.error) throw new Error('UI probe: ' + ui.error + ' ' + JSON.stringify(ui));

    console.log('');
    console.log('video rect      : ' + ui.rect.w + 'x' + ui.rect.h + ' at (' + ui.rect.x + ',' + ui.rect.y
      + ')  viewport ' + ui.viewport.w + 'x' + ui.viewport.h + '  scrollY ' + ui.scrollY);
    console.log('UI hit-test (topmost element over the video):');
    ui.hits.forEach(h => {
      console.log('  ' + (h.ok ? 'PASS' : 'FAIL') + '  at ' + h.at.padEnd(5) + ' -> ' + h.top);
      if (!h.ok) problems.push('element "' + h.top + '" covers the video at ' + h.at);
    });
    console.log('control bar     : ' + ui.controlBar.top + '  reachable=' + ui.controlBar.reachable
      + '  pointer-events=' + ui.controlBar.pointerEvents + '  z-index=' + ui.controlBar.zIndex);
    if (!ui.controlBar.reachable) {
      problems.push('the control bar is covered by ' + ui.controlBar.top + ' (clicks cannot reach the progress bar)');
    }
    console.log('stack at bar    : ' + ui.stack.join(' > '));

    const readTime = async () => parseFloat(await evaluate('(+document.querySelector("video").currentTime).toFixed(3)'));

    await cdp.send('Runtime.evaluate', {
      expression: '(()=>{const v=document.querySelector("video");v.muted=true;v.currentTime=0;return v.play().then(()=>1).catch(()=>0)})()',
      awaitPromise: true, returnByValue: true
    });
    await sleep(1500);
    /* reveal the native control bar, then move the playhead with real clicks */
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ui.center.x, y: ui.center.y, buttons: 0 });
    await sleep(500);

    console.log('');
    console.log('real mouse clicks on the progress bar (video playing):');
    for (const step of [ui.timeline.x20, ui.timeline.x80]) {
      const frac = (step - ui.rect.x) / ui.rect.w;
      await clickAt(step, ui.timeline.y);
      await sleep(700);
      const now = await readTime();
      const expect = out.duration * frac;
      const ok = Math.abs(now - expect) <= out.duration * 0.12;
      if (!ok) {
        problems.push('clicking the progress bar at ' + Math.round(frac * 100)
          + '% did not scrub (currentTime ' + now + 's, expected ~' + expect.toFixed(1) + 's)');
      }
      console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  click at x=' + step + ' (~' + Math.round(frac * 100)
        + '% of the bar) -> currentTime ' + now + 's (expected ~' + expect.toFixed(1) + 's)');
    }

    await sleep(600);
    reportStats();

    console.log('');
    console.log(problems.length
      ? 'RESULT: ' + problems.length + ' PROBLEM(S)\n  - ' + problems.join('\n  - ')
      : 'RESULT: TRAILER SCRUBS CORRECTLY (paused + during playback)');
    exitCode = problems.length ? 1 : 0;
  } catch (err) {
    console.error('FATAL: ' + err.message);
    reportStats();
    exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (chrome && !chrome.killed) chrome.kill();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    process.exit(exitCode);
  }
})();

