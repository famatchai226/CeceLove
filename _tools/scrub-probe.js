/* Page-side UI probe (runs inside Chrome via CDP Runtime.evaluate).

   Answers: "can the user actually grab the progress bar?"
   - scrolls the trailer into view (forcing an INSTANT scroll: these landing pages
     use `scroll-behavior: smooth`, which would otherwise make scrollIntoView
     animate and hand us an off-screen rect)
   - hit-tests a grid over the video element (the topmost element returned by
     document.elementFromPoint must be the <video> itself, otherwise something
     is sitting on top of it and swallowing the clicks)
   - reports the viewport coordinates of the timeline so the driver can click it
     for real through CDP Input.dispatchMouseEvent. */
async function uiProbe() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const v = document.querySelector('video');
  if (!v) return { error: 'no <video> element on the page' };

  const html = document.documentElement;
  const prev = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  v.scrollIntoView({ block: 'center', behavior: 'instant' });
  if (v.getBoundingClientRect().top > innerHeight || v.getBoundingClientRect().bottom < 0) {
    const r0 = v.getBoundingClientRect();
    scrollTo(0, scrollY + r0.top - (innerHeight - r0.height) / 2);
  }
  await wait(50);
  html.style.scrollBehavior = prev;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await wait(250);

  const r = v.getBoundingClientRect();
  const at = (x, y) => document.elementFromPoint(x, y);
  const label = el => el
    ? el.tagName + (el.id ? '#' + el.id : '') +
      (el.className && typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/)[0] : '')
    : 'null';

  const out = {
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    viewport: { w: innerWidth, h: innerHeight },
    scrollY: Math.round(scrollY),
    inViewport: r.top < innerHeight && r.bottom > 0,
    hits: []
  };
  if (!out.inViewport) return Object.assign(out, { error: 'video is not in the viewport' });

  /* grid hit-test: the video itself must be the topmost element everywhere */
  for (const fy of [0.1, 0.4, 0.7, 0.92]) {
    for (const fx of [0.1, 0.5, 0.9]) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      const el = at(x, y);
      out.hits.push({ at: fx + '/' + fy, top: label(el), ok: el === v });
    }
  }

  /* the control bar (and therefore the progress bar) lives in the bottom strip */
  const barY = Math.round(r.bottom - 18);
  const barEl = at(Math.round(r.x + r.width * 0.5), barY);
  out.controlBar = {
    y: barY,
    top: label(barEl),
    reachable: barEl === v,
    pointerEvents: barEl ? getComputedStyle(barEl).pointerEvents : null,
    zIndex: barEl ? getComputedStyle(barEl).zIndex : null,
    position: barEl ? getComputedStyle(barEl).position : null
  };

  /* every element stacked over the control bar centre */
  const cx = Math.round(r.x + r.width * 0.5);
  out.stack = (document.elementsFromPoint ? document.elementsFromPoint(cx, barY) : [])
    .map(el => label(el) + (el === v ? '  <-- the video' : ''));
  out.timeline = { y: barY, x10: Math.round(r.x + r.width * 0.10), x20: Math.round(r.x + r.width * 0.20), x80: Math.round(r.x + r.width * 0.80) };
  out.center = { x: cx, y: Math.round(r.y + r.height * 0.5) };
  return out;
}
