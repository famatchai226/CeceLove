/* Page-side probe (runs inside Chrome via CDP Runtime.evaluate).
   Grabs the real <video> from the trailer section of the landing page and:
     1. waits for metadata,
     2. seeks while PAUSED to several positions spread over the whole timeline,
     3. seeks WHILE PLAYING (this is the behaviour that used to break),
   returning timing + landed positions as JSON. */
async function probe() {
  const out = { steps: [], errors: [] };
  const v = document.querySelector('video');
  if (!v) { out.errors.push('no <video> element on the page'); return out; }

  const source = v.currentSrc || v.getAttribute('src') ||
    (v.querySelector('source') ? v.querySelector('source').getAttribute('src') : null);
  out.src = source;
  out.preload = v.getAttribute('preload');
  out.controls = v.hasAttribute('controls');
  out.h264Supported = v.canPlayType('video/mp4; codecs="avc1.42E01E"') || '(empty)';

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const once = (el, name, ms) => new Promise((resolve, reject) => {
    const on = e => { clearTimeout(to); el.removeEventListener(name, on); resolve(e); };
    const to = setTimeout(() => {
      el.removeEventListener(name, on);
      reject(new Error('timeout waiting for "' + name + '"'));
    }, ms);
    el.addEventListener(name, on);
  });

  const snap = () => ({
    readyState: v.readyState,
    networkState: v.networkState,
    currentTime: +v.currentTime.toFixed(3),
    duration: v.duration ? +v.duration.toFixed(3) : 0,
    seekableEnd: v.seekable.length ? +v.seekable.end(0).toFixed(3) : 0,
    bufferedEnd: v.buffered.length ? +v.buffered.end(v.buffered.length - 1).toFixed(3) : 0,
    paused: v.paused
  });

  if (v.readyState < 1) {
    try { await once(v, 'loadedmetadata', 25000); }
    catch (e) { out.errors.push('loadedmetadata: ' + e.message); return out; }
  }
  out.afterMetadata = snap();
  out.readyStateAfterMetadata = v.readyState;

  /* let the player settle: Chrome is still filling its initial buffer right after
     loadedmetadata, and a seek issued in that window competes with that fetch. */
  await wait(1500);
  out.afterSettle = snap();

  const dur = v.duration;
  if (!isFinite(dur) || dur <= 0) {
    out.errors.push('video has no decodable duration (duration=' + v.duration +
      ', readyState=' + v.readyState + ', error=' + (v.error ? v.error.code : 'none') + ')');
    return out;
  }
  out.duration = +dur.toFixed(3);

  /* --- 1. seeks while paused, walking the whole timeline --- */
  for (const frac of [0.05, 0.25, 0.5, 0.75, 0.9]) {
    const target = dur * frac;
    const t0 = performance.now();
    v.currentTime = target;
    try { await once(v, 'seeked', 25000); }
    catch (e) { out.errors.push('paused seek ' + frac + ': ' + e.message); continue; }
    out.steps.push({
      mode: 'paused',
      target: +target.toFixed(3),
      landed: +v.currentTime.toFixed(3),
      delta: +Math.abs(v.currentTime - target).toFixed(3),
      ms: Math.round(performance.now() - t0),
      readyState: v.readyState,
      seekableEnd: v.seekable.length ? +v.seekable.end(0).toFixed(3) : 0
    });
  }

  /* --- 2. seeking while the video is actually PLAYING (reported bug) --- */
  try {
    v.muted = true;
    v.currentTime = 0;
    const playing = once(v, 'playing', 12000).catch(() => {});
    const p = v.play();
    if (p && p.then) p.catch(e => out.errors.push('play(): ' + e.message));
    await playing;
    await wait(1500);
    out.playingBefore = snap();

    const target = dur * 0.6;
    const t0 = performance.now();
    v.currentTime = target;
    await once(v, 'seeked', 12000);
    out.steps.push({
      mode: 'playing',
      target: +target.toFixed(3),
      landed: +v.currentTime.toFixed(3),
      delta: +Math.abs(v.currentTime - target).toFixed(3),
      ms: Math.round(performance.now() - t0),
      readyState: v.readyState,
      seekableEnd: v.seekable.length ? +v.seekable.end(0).toFixed(3) : 0
    });

    await wait(1500);
    out.playingAfter = snap();
    v.pause();
  } catch (e) {
    out.errors.push('playing seek: ' + e.message);
  }

  return out;
}
