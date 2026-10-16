/* Diagnostic du seek SUR MOBILE, sur la page EN LIGNE.

   Le serveur de production (Cloudflare) ignore les requetes HTTP `Range` : il renvoie
   toujours `200` + le fichier entier. Un navigateur mobile ne peut donc pas telecharger
   la bande-annonce « par morceaux » et le deplacement dans la timeline echoue.
   Ce script le mesure pour de vrai : Chrome headless en emulation telephone (390x844,
   tactile, UA Android), sur l'URL de production :

     A. dans l'etat actuel de la page (`preload="metadata"`) -> seek mesure
     B. avec `preload="auto"` + `load()` (fichier telecharge en entier) -> seek re-mesure

   Si B passe et pas A, le correctif applicatif est de forcer le buffer complet.

   Usage:
     node _tools/mobile-seek-live.js
     node _tools/mobile-seek-live.js --url=https://cecelove.famatchai226.workers.dev/
     node _tools/mobile-seek-live.js "C:\chemin\chrome.exe"
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const argUrl = process.argv.find(a => a.startsWith('--url='));
const PAGE_URL = (argUrl ? argUrl.split('=').slice(1).join('=') : 'https://cecelove.famatchai226.workers.dev/');
const CHROME = process.argv.slice(2).find(a => !a.startsWith('--'))
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9344;
const ALT = (process.argv.find(a => a.startsWith('--alt=')) || '').split('=').slice(1).join('=') || null;
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Mobile Safari/537.36';
const SEEKTIMEOUT = 20000;   /* « ca ne marche pas » pour un visiteur = rien en 20 s */
const BUFFERTIMEOUT = 120000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
          }, 300000);
        });
      },
      close() { try { ws.close(); } catch (e) {} }
    }));
  });
}

const getJson = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
};

/* ---------- ce que le navigateur croit pouvoir faire ---------- */
const STATE = `(() => {
  const v = document.querySelector('video');
  if (!v) return { error: 'no <video>' };
  const ranges = r => { const o = []; for (let i = 0; i < r.length; i++)
    o.push([+r.start(i).toFixed(2), +r.end(i).toFixed(2)]); return o; };
  return { src: (v.currentSrc || '').split('/').pop(), preload: v.getAttribute('preload'), readyState: v.readyState,
    networkState: v.networkState, duration: v.duration ? +v.duration.toFixed(2) : 0,
    currentTime: +v.currentTime.toFixed(2), paused: v.paused,
    controls: v.hasAttribute('controls'), playsinline: v.hasAttribute('playsinline'),
    seekable: ranges(v.seekable), buffered: ranges(v.buffered),
    error: v.error ? { code: v.error.code, msg: v.error.message } : null };
})()`;

/* ---------- seek pendant la pause, avec timeout court ---------- */
const seekPaused = frac => `(() => {
  const v = document.querySelector('video');
  const target = v.duration * ${frac};
  const t0 = performance.now();
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true;
      v.removeEventListener('seeked', onSeeked);
      resolve({ ok, ms: Math.round(performance.now() - t0), target: +target.toFixed(2),
        landed: +v.currentTime.toFixed(2), delta: +Math.abs(v.currentTime - target).toFixed(2),
        bufferedEnd: v.buffered.length ? +v.buffered.end(v.buffered.length - 1).toFixed(2) : 0,
        seekableEnd: v.seekable.length ? +v.seekable.end(0).toFixed(2) : 0 }); };
    const okNow = () => v.duration > 0 && Math.abs(v.currentTime - target) <= Math.max(1, v.duration * 0.03);
    const onSeeked = () => setTimeout(() => finish(okNow()), 150);
    v.addEventListener('seeked', onSeeked);
    try { v.currentTime = target; } catch (e) { finish(false); return; }
    setTimeout(() => finish(okNow()), ${SEEKTIMEOUT});
  });
})()`;

/* ---------- seek pendant la lecture (muted : autorise sans geste) ---------- */
const seekPlaying = frac => `(() => {
  const v = document.querySelector('video');
  const target = v.duration * ${frac};
  const t0 = performance.now();
  v.muted = true;
  return v.play().then(() => new Promise(resolve => {
    setTimeout(() => {
      let done = false;
      const finish = ok => { if (done) return; done = true;
        v.removeEventListener('seeked', onSeeked);
        v.pause();
        resolve({ ok, ms: Math.round(performance.now() - t0), target: +target.toFixed(2),
          landed: +v.currentTime.toFixed(2), delta: +Math.abs(v.currentTime - target).toFixed(2),
          bufferedEnd: v.buffered.length ? +v.buffered.end(v.buffered.length - 1).toFixed(2) : 0 }); };
      const okNow = () => v.duration > 0 && Math.abs(v.currentTime - target) <= Math.max(1, v.duration * 0.03);
      const onSeeked = () => setTimeout(() => finish(okNow()), 150);
      v.addEventListener('seeked', onSeeked);
      v.currentTime = target;
      setTimeout(() => finish(okNow()), ${SEEKTIMEOUT});
    }, 2000);
  })).catch(e => ({ ok: false, error: e.message }));
})()`;

/* ---------- attendre que TOUT soit telecharge (aucun Range requis) ---------- */
const waitBuffered = `(() => {
  const v = document.querySelector('video');
  const t0 = performance.now();
  return new Promise(resolve => {
    (function poll() {
      const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
      if (v.duration && end >= v.duration - 0.5) return resolve({ ok: true,
        ms: Math.round(performance.now() - t0), bufferedEnd: +end.toFixed(2) });
      if (performance.now() - t0 > ${BUFFERTIMEOUT}) return resolve({ ok: false,
        ms: Math.round(performance.now() - t0), bufferedEnd: +end.toFixed(2),
        readyState: v.readyState, networkState: v.networkState });
      setTimeout(poll, 500);
    })();
  });
})()`;

(async () => {
  let chrome = null, cdp = null, exitCode = 1;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cecelove-mobile-'));
  const problems = [];
  let cOk = null;

  try {
    console.log('cible        : ' + PAGE_URL);
    console.log('emulation    : Pixel 7 (390x844, tactile, UA Android)');

    /* la source reellement servie par la page repond-elle 206 ? */
    let trailerUrl = PAGE_URL + 'assets/trailer.mp4';
    try {
      const page = await fetch(PAGE_URL);
      const html = await page.text();
      const m = html.match(/<source src="([^"]+)"[^>]*type="video\/mp4"/);
      if (m) trailerUrl = /^https?:/i.test(m[1]) ? m[1] : PAGE_URL + m[1].replace(/^\.\//, '');
    } catch (e) { /* on garde l URL locale par defaut */ }
    const r = await fetch(trailerUrl, { headers: { Range: 'bytes=0-1023' } });
    const reader = r.body.getReader();
    await reader.read();
    await reader.cancel().catch(() => {});
    console.log('trailer      : ' + trailerUrl);
    console.log('range test   : HTTP ' + r.status + ' | accept-ranges=' + r.headers.get('accept-ranges') +
      ' | content-range=' + r.headers.get('content-range'));
    if (r.status !== 206) {
      problems.push('la source servie ignore Range (HTTP ' + r.status + ') -> seek impossible');
    }

    chrome = spawn(CHROME, [
      '--headless=new',
      '--remote-debugging-port=' + CDP_PORT,
      '--remote-allow-origins=*',
      '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=390,844',
      'about:blank'
    ], { stdio: 'ignore' });

    let version = null;
    for (let i = 0; i < 60 && !version; i++) {
      try { version = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); }
      catch (e) { await sleep(500); }
    }
    if (!version) throw new Error('Chrome DevTools endpoint never came up');
    console.log('chrome       : ' + version.Browser);

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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true
    });
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'Android' });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const evaluate = async expr => (await cdp.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true
    })).result.value;

    cdp.send('Page.navigate', { url: PAGE_URL }).catch(() => {});

    /* attendre les metadonnees */
    const ready = await evaluate(`new Promise(r => {
      const t0 = Date.now();
      (function poll() {
        const v = document.querySelector('video');
        if (v && v.readyState >= 1) return r({ ok: true, readyState: v.readyState, duration: +v.duration.toFixed(2) });
        if (Date.now() - t0 > 40000) return r({ ok: false, readyState: v ? v.readyState : -1,
          error: v && v.error ? v.error.code : null });
        setTimeout(poll, 250);
      })();
    })`);
    console.log('video        : ' + JSON.stringify(ready));
    if (!ready.ok) throw new Error('la video n a jamais livre ses metadonnees');

    /* fermer l'age gate 18+ comme un visiteur */
    for (let i = 0; i < 40; i++) {
      const g = await evaluate(`(() => {
        const gate = document.getElementById('ageGate');
        if (!gate) return null;
        if (gate.hasAttribute('hidden')) return { already: true };
        const b = document.getElementById('ageGateYes');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()`);
      if (g && g.already) break;
      if (g && g.x !== undefined) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.x, y: g.y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(600);
        break;
      }
      await sleep(250);
    }

    /* journal des evenements media : montre les remises a zero du chargement */
    await evaluate(`(() => {
      const v = document.querySelector('video');
      window.__log = [];
      ['loadstart', 'emptied', 'stalled', 'suspend', 'progress', 'seeking', 'seeked',
       'waiting', 'durationchange', 'error'].forEach(n => v.addEventListener(n, () => {
        window.__log.push(n + '@' + v.currentTime.toFixed(1) + ' rs=' + v.readyState +
          ' ns=' + v.networkState + ' buf=' + (v.buffered.length ? v.buffered.end(v.buffered.length - 1).toFixed(1) : 0));
      }));
      return 1;
    })()`);

    /* Chrome ne bufferise pas un media hors ecran : on amene la video dans le viewport */
    await evaluate(`(() => { const v = document.querySelector('video');
      v.scrollIntoView({ block: 'center' }); return 1; })()`);
    await sleep(1000);

    const printState = s => {
      console.log('etat         : src=' + s.src + ' preload=' + s.preload + ' readyState=' + s.readyState
        + ' networkState=' + s.networkState + ' duration=' + s.duration + 's'
        + ' controls=' + s.controls + ' playsinline=' + s.playsinline);
      console.log('seekable     : ' + JSON.stringify(s.seekable));
      console.log('buffered     : ' + JSON.stringify(s.buffered));
      if (s.error) console.log('video.error  : ' + JSON.stringify(s.error));
    };

    /* ============ A. etat actuel de la page ============ */
    console.log('');
    console.log('=== A. etat livre (preload="metadata"), video visible et en lecture ===');
    let st = await evaluate(STATE);
    printState(st);
    /* lecture silencieuse : ce que fait un visiteur qui appuie sur play */
    await evaluate(`(() => { const v = document.querySelector('video'); v.muted = true;
      return v.play().then(() => 1).catch(e => e.message); })()`);
    await sleep(3000);
    console.log('apres 3 s de lecture :');
    st = await evaluate(STATE);
    printState(st);
    const seekableA = JSON.stringify(st.seekable);
    const bufferedA = JSON.stringify(st.buffered);
    const a1 = await evaluate(seekPlaying(0.9));
    console.log('seek 90% (lecture) : ' + (a1.ok ? 'PASS' : 'BLOQUE') + ' cible=' + a1.target + 's'
      + ' atteint=' + a1.landed + 's (' + a1.ms + ' ms, buffer=' + a1.bufferedEnd + 's)'
      + (a1.error ? ' [' + a1.error + ']' : ''));
    const a2 = await evaluate(seekPlaying(0.1));
    console.log('seek 10% (lecture) : ' + (a2.ok ? 'PASS' : 'BLOQUE') + ' cible=' + a2.target + 's'
      + ' atteint=' + a2.landed + 's (' + a2.ms + ' ms, buffer=' + a2.bufferedEnd + 's)');
    const aOk = a1.ok && a2.ok;
    if (!aOk) problems.push('etat livre : seek impossible (' + a1.ms + ' ms, cible ' + a1.target
      + 's, atteint ' + a1.landed + 's)');

    /* ============ B. fichier telecharge en entier ============ */
    console.log('');
    console.log('=== B. avec preload="auto" + load() : fichier entier a disposition ===');
    await evaluate(`(() => { const v = document.querySelector('video'); v.preload = 'auto'; v.muted = true;
      v.load(); return v.play().then(() => 1).catch(e => e.message); })()`);
    const t0 = Date.now();
    const buf = await evaluate(waitBuffered);
    console.log('buffer       : ' + (buf.ok ? 'COMPLET' : 'INCOMPLET') + ' en ' + Math.round((Date.now() - t0) / 1000)
      + 's (' + buf.bufferedEnd + 's' + (buf.readyState !== undefined ? ', readyState=' + buf.readyState : '') + ')');
    st = await evaluate(STATE);
    printState(st);
    const b1 = await evaluate(seekPaused(0.9));
    console.log('seek 90% (pause)   : ' + (b1.ok ? 'PASS' : 'BLOQUE') + ' cible=' + b1.target + 's'
      + ' atteint=' + b1.landed + 's (' + b1.ms + ' ms)');
    const b2 = await evaluate(seekPlaying(0.9));
    console.log('seek 90% (lecture) : ' + (b2.ok ? 'PASS' : 'BLOQUE') + ' cible=' + b2.target + 's'
      + ' atteint=' + b2.landed + 's (' + b2.ms + ' ms)');
    const b3 = await evaluate(seekPlaying(0.1));
    console.log('seek 10% (lecture) : ' + (b3.ok ? 'PASS' : 'BLOQUE') + ' cible=' + b3.target + 's'
      + ' atteint=' + b3.landed + 's (' + b3.ms + ' ms)');
    const bOk = b1.ok && b2.ok && b3.ok;
    if (!bOk) problems.push('meme avec le fichier complet, un seek a echoue');

    /* ============ C. source alternative (hebergeur qui gere Range) ============ */
    if (ALT) {
      console.log('');
      console.log('=== C. source alternative : ' + ALT + ' ===');
      await evaluate(`(() => { const v = document.querySelector('video'); v.pause();
        const s = v.querySelector('source');
        if (s) s.setAttribute('src', ${JSON.stringify(ALT)}); else v.setAttribute('src', ${JSON.stringify(ALT)});
        v.load(); v.muted = true; return v.play().then(() => 1).catch(e => e.message); })()`);
      await sleep(2500);
      st = await evaluate(STATE);
      printState(st);
      const c1 = await evaluate(seekPaused(0.9));
      console.log('seek 90% (pause)   : ' + (c1.ok ? 'PASS' : 'BLOQUE') + ' cible=' + c1.target + 's'
        + ' atteint=' + c1.landed + 's (' + c1.ms + ' ms)');
      const c2 = await evaluate(seekPlaying(0.9));
      console.log('seek 90% (lecture) : ' + (c2.ok ? 'PASS' : 'BLOQUE') + ' cible=' + c2.target + 's'
        + ' atteint=' + c2.landed + 's (' + c2.ms + ' ms)');
      const c3 = await evaluate(seekPlaying(0.1));
      console.log('seek 10% (lecture) : ' + (c3.ok ? 'PASS' : 'BLOQUE') + ' cible=' + c3.target + 's'
        + ' atteint=' + c3.landed + 's (' + c3.ms + ' ms)');
      cOk = c1.ok && c2.ok && c3.ok;
      if (!cOk) problems.push('la source alternative ne permet pas non plus le seek');
    }

    /* ============ D. bascule de langue (le script de langue touche a la source video) ============ */
    console.log('');
    console.log('=== D. bascule FR <-> EN ===');
    const langBefore = await evaluate('document.documentElement.lang');
    await evaluate(`(() => { const b = document.querySelector('.lang-toggle'); if (!b) return null;
      b.click(); return 1; })()`);
    await sleep(1500);
    const langAfter = await evaluate('document.documentElement.lang');
    const stD = await evaluate(STATE);
    console.log('langue       : ' + langBefore + ' -> ' + langAfter);
    printState(stD);
    const d1 = await evaluate(seekPlaying(0.5));
    console.log('seek 50% (lecture) : ' + (d1.ok ? 'PASS' : 'BLOQUE') + ' cible=' + d1.target + 's'
      + ' atteint=' + d1.landed + 's (' + d1.ms + ' ms)');
    if (langAfter === langBefore) problems.push('la bascule de langue n a rien change (' + langBefore + ')');
    if (!/trailer\.mp4/.test(stD.src || '')) problems.push('source video perdue apres bascule : ' + stD.src);
    if (!d1.ok) problems.push('apres bascule de langue, le seek ne fonctionne plus');

    /* ============ verdict ============ */
    const mediaLog = await evaluate('(window.__log || []).slice(-30)');
    console.log('');
    console.log('evenements   : ' + JSON.stringify(mediaLog));
    console.log('');
    if (aOk) {
      console.log('DIAGNOSTIC : les seek passent dans l etat livre (rien a corriger).');
    } else if (buf.ok) {
      console.log('DIAGNOSTIC : le fichier est ENTIER en memoire (buffered ' + bufferedA + ') mais');
      console.log('             seekable=' + seekableA + ' et aucun seek ne porte : le host');
      console.log('             n annonce pas Accept-Ranges, donc Chrome interdit tout deplacement.');
      console.log('             -> preload="auto" ne peut PAS reparer ce cas : il faut un host qui gere Range.');
    } else {
      console.log('DIAGNOSTIC : le buffer ne se remplit pas completement ; reseau lent ou media bloque.');
    }
    if (ALT) {
      console.log(cOk ? '             avec ' + ALT + ' : seek OK -> heberger la bande-annonce la.'
                      : '             avec ' + ALT + ' : seek toujours bloque.');
    }
    console.log('');
    console.log(problems.length
      ? 'RESULT: ' + problems.length + ' PROBLEME(S)\n  - ' + problems.join('\n  - ')
      : 'RESULT: TOUS LES SEEK PASSENT');
    exitCode = aOk ? 0 : 1;
  } catch (err) {
    console.error('FATAL: ' + err.message);
    exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (chrome && !chrome.killed) chrome.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    process.exit(exitCode);
  }
})();
