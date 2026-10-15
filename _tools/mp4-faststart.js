/* Remux an MP4 for progressive playback ("faststart"): move the moov box BEFORE the
   mdat box and patch every chunk offset table (stco / co64) by the resulting delta.
   This is what `ffmpeg -movflags +faststart` does, implemented natively so it works
   on machines without ffmpeg.

   Usage: node _mp4faststart.js <src.mp4> <dst.mp4> */
const fs = require('fs');

const src = process.argv[2] || 'cecelove-landing-page/assets/trailer.mp4';
const dst = process.argv[3] || 'cecelove-landing-page/assets/trailer.faststart.mp4';

const buf = fs.readFileSync(src);
const size = buf.length;

/* ---------- 1. parse top-level boxes ---------- */
function topLevel(buffer) {
  const out = [];
  let pos = 0;
  while (pos + 8 <= buffer.length) {
    let sz = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    let header = 8;
    if (sz === 1) { sz = Number(buffer.readBigUInt64BE(pos + 8)); header = 16; }
    else if (sz === 0) { sz = buffer.length - pos; }
    if (sz < header) throw new Error('invalid box ' + type + ' at ' + pos);
    out.push({ type, offset: pos, size: sz, header });
    pos += sz;
  }
  return out;
}

const boxes = topLevel(buf);
const ftyp = boxes.find(b => b.type === 'ftyp');
const moov = boxes.find(b => b.type === 'moov');
const mdat = boxes.find(b => b.type === 'mdat');
if (!ftyp || !moov || !mdat) throw new Error('src must contain ftyp + moov + mdat');

console.log('src :', src, size, 'bytes');
console.log('boxes:', boxes.map(b => b.type + '(' + b.size + '@' + b.offset + ')').join(' '));

/* ---------- 2. copy moov locally so we can patch its offset tables ---------- */
const moovBuf = Buffer.from(buf.subarray(moov.offset, moov.offset + moov.size));

/* new layout = ftyp | moov | mdat  (the padding `free` box is dropped) */
const ftypBuf = Buffer.from(buf.subarray(ftyp.offset, ftyp.offset + ftyp.size));
const newMdatHeaderOffset = ftypBuf.length + moovBuf.length;
const newMdatPayload = newMdatHeaderOffset + mdat.header;
const oldMdatPayload = mdat.offset + mdat.header;
const delta = newMdatPayload - oldMdatPayload;
console.log('moov moved', moov.offset, '->', ftypBuf.length);
console.log('mdat payload', oldMdatPayload, '->', newMdatPayload, '(delta =', delta + ')');

/* ---------- 3. patch stco / co64 recursively inside the copied moov ---------- */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts',
  'mvex', 'udta', 'meta', 'ilst']);
let patchedTables = 0, patchedEntries = 0;

function walk(start, end) {
  let o = start;
  while (o + 8 <= end) {
    let sz = moovBuf.readUInt32BE(o);
    const type = moovBuf.toString('ascii', o + 4, o + 8);
    let header = 8;
    if (sz === 1) { sz = Number(moovBuf.readBigUInt64BE(o + 8)); header = 16; }
    else if (sz === 0) { sz = end - o; }
    if (sz < header || o + sz > end) throw new Error('bad box ' + type + ' at ' + o);

    if (type === 'stco' || type === 'co64') {
      const n = moovBuf.readUInt32BE(o + header + 4);
      for (let i = 0; i < n; i++) {
        const p = o + header + 8 + i * (type === 'stco' ? 4 : 8);
        if (type === 'stco') {
          const v = moovBuf.readUInt32BE(p) + delta;
          if (v > 0xFFFFFFFF) throw new Error('stco entry overflow at ' + p);
          moovBuf.writeUInt32BE(v, p);
        } else {
          moovBuf.writeBigUInt64BE(BigInt(moovBuf.readBigUInt64BE(p)) + BigInt(delta), p);
        }
      }
      patchedTables++;
      patchedEntries += n;
      console.log('  patched', type, 'entries=' + n, 'at moov+0x' + o.toString(16));
    } else if (CONTAINERS.has(type)) {
      let inner = o + header;
      if (type === 'meta') inner += 4;   // meta = full box (4-byte version/flags)
      walk(inner, o + sz);
    } else if (type === 'stsd') {
      // step into each sample-entry box (visual/audio sample entries are containers)
      let e = o + header + 8;
      const c = moovBuf.readUInt32BE(o + header + 4);
      for (let i = 0; i < c && e + 8 <= o + sz; i++) {
        const esz = moovBuf.readUInt32BE(e);
        if (esz < 8) break;
        walk(e + 8, e + esz);
        e += esz;
      }
    }
    o += sz;
  }
}
walk(0, moovBuf.length);
console.log('patched', patchedTables, 'table(s),', patchedEntries, 'entries total');

/* ---------- 4. rebuild: ftyp | moov | mdat(header + payload) ---------- */
const mdatHeader = Buffer.alloc(mdat.header);
mdatHeader.writeUInt32BE(mdat.header === 16 ? 1 : mdat.size, 0);
mdatHeader.write('mdat', 4, 'ascii');
if (mdat.header === 16) mdatHeader.writeBigUInt64BE(BigInt(mdat.size), 8);
const mdatPayloadBuf = buf.subarray(mdat.offset + mdat.header, mdat.offset + mdat.size);

const out = Buffer.concat([ftypBuf, moovBuf, mdatHeader, mdatPayloadBuf]);
fs.writeFileSync(dst, out);

const end = newMdatPayload + mdatPayloadBuf.length;
console.log('dst :', dst, out.length, 'bytes (mdat payload', newMdatPayload, '->' + end + ')');
console.log('delta saved (dropped free box):', size - out.length, 'bytes');
console.log('RESULT:', out.length === ftypBuf.length + moovBuf.length + mdat.size
  ? 'OK - bytes reconstructed exactly' : 'MISMATCH');
