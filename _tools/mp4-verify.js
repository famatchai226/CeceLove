/* Validate an MP4 file structurally, chunk-by-chunk:
   - box order (faststart => moov before mdat)
   - every chunk offset resolves inside the mdat payload and the chunk fits in the file
   - stsc / stsz / stco arithmetic is consistent
   Usage: node _mp4verify.js <file.mp4> */
const fs = require('fs');

const file = process.argv[2] || 'cecelove-landing-page/assets/trailer.mp4';
const buf = fs.readFileSync(file);
const size = buf.length;

function topLevel() {
  const out = [];
  let pos = 0;
  while (pos + 8 <= size) {
    let sz = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    let header = 8;
    if (sz === 1) { sz = Number(buf.readBigUInt64BE(pos + 8)); header = 16; }
    else if (sz === 0) { sz = size - pos; }
    out.push({ type, offset: pos, size: sz, header });
    pos += sz;
  }
  out.consumed = pos;
  return out;
}
const boxes = topLevel();
const moov = boxes.find(b => b.type === 'moov');
const mdat = boxes.find(b => b.type === 'mdat');

const problems = [];
const ck = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) problems.push(msg);
};

console.log('== ' + file + ' (' + size + ' bytes) ==');
ck(boxes.consumed === size, 'all top-level boxes parsed, none left over (' + boxes.consumed + '/' + size + ')');
ck(!!moov && !!mdat, 'ftyp + moov + mdat present');
/* walk the moov tree, recording local offsets */
const found = [];
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts',
  'mvex', 'udta', 'meta', 'ilst']);
function walk(start, end, depth) {
  let o = start;
  while (o + 8 <= end) {
    let sz = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    let header = 8;
    if (sz === 1) { sz = Number(buf.readBigUInt64BE(o + 8)); header = 16; }
    else if (sz === 0) { sz = end - o; }
    if (sz < header || o + sz > end) { problems.push('malformed box ' + type + ' @' + o); return; }
    found.push({ type, offset: o, size: sz, header, depth });
    if (CONTAINERS.has(type)) {
      let inner = o + header;
      if (type === 'meta') inner += 4;
      walk(inner, o + sz, depth + 1);
    } else if (type === 'stsd') {
      let e = o + header + 8;
      const c = buf.readUInt32BE(o + header + 4);
      for (let i = 0; i < c && e + 8 <= o + sz; i++) {
        const esz = buf.readUInt32BE(e);
        if (esz < 8) break;
        walk(e + 8, e + esz, depth + 1);
        e += esz;
      }
    }
    o += sz;
  }
}
walk(moov.offset + moov.header, moov.offset + moov.size, 0);
ck(moov.offset + moov.size === mdat.offset, 'moov ends exactly where mdat starts (no gap / no corruption)');

const trakBoxes = found.filter(f => f.type === 'trak' && f.depth === 0);
console.log('');
console.log('tracks:', trakBoxes.length);
ck(trakBoxes.length > 0, 'at least one trak inside moov');

const mdatPayload = mdat.offset + mdat.header;
const mdatEnd = mdat.offset + mdat.size;

ck(moov.offset < mdat.offset, 'FASTSTART: moov (' + moov.offset + ') before mdat (' + mdat.offset + ')');
ck(mdat.offset + mdat.size === size, 'mdat is the last box and reaches EOF');
console.log('');

trakBoxes.forEach((trak, ti) => {
  const inside = found.filter(f => f.offset > trak.offset && f.offset < trak.offset + trak.size);
  const stsz = inside.find(f => f.type === 'stsz');
  const stsc = inside.find(f => f.type === 'stsc');
  const stco = inside.find(f => f.type === 'stco') || inside.find(f => f.type === 'co64');
  const hdlr = inside.find(f => f.type === 'hdlr');
  const name = stco.type;
  const handle = buf.toString('ascii', hdlr.offset + hdlr.header + 8, hdlr.offset + hdlr.header + 12);

  /* sample sizes */
  const sampleSize = buf.readUInt32BE(stsz.offset + stsz.header + 4);
  const nSamples = buf.readUInt32BE(stsz.offset + stsz.header + 8);
  const sizes = [];
  for (let i = 0; i < nSamples; i++) {
    sizes.push(sampleSize !== 0 ? sampleSize
      : buf.readUInt32BE(stsz.offset + stsz.header + 12 + i * 4));
  }

  /* chunk -> sample mapping */
  const nStsc = buf.readUInt32BE(stsc.offset + stsc.header + 4);
  const stscEntries = [];
  for (let i = 0; i < nStsc; i++) {
    const p = stsc.offset + stsc.header + 8 + i * 12;
    stscEntries.push({
      firstChunk: buf.readUInt32BE(p),
      samplesPerChunk: buf.readUInt32BE(p + 4)
    });
  }
  stscEntries.sort((a, b) => a.firstChunk - b.firstChunk);

  /* chunk offsets */
  const nChunks = buf.readUInt32BE(stco.offset + stco.header + 4);
  const offsets = [];
  for (let i = 0; i < nChunks; i++) {
    offsets.push(name === 'stco'
      ? buf.readUInt32BE(stco.offset + stco.header + 8 + i * 4)
      : Number(buf.readBigUInt64BE(stco.offset + stco.header + 8 + i * 8)));
  }

  console.log('');
  console.log('-- track ' + (ti + 1) + ' [' + handle + '] --');
  console.log('   samples=' + nSamples, 'chunks=' + nChunks, 'table=' + name,
    'offset range ' + Math.min.apply(null, offsets) + '..' + Math.max.apply(null, offsets));

  ck(Math.min.apply(null, offsets) >= mdatPayload,
    '[' + handle + '] every chunk offset >= mdat payload start (' + mdatPayload + ')');
  ck(Math.max.apply(null, offsets) < mdatEnd,
    '[' + handle + '] every chunk offset < mdat end (' + mdatEnd + ')');
  ck(offsets.every((v, i) => i === 0 || v > offsets[i - 1]),
    '[' + handle + '] chunk offsets strictly increasing inside the track');

  /* resolve every chunk's byte range with stsc + stsz */
  let sample = 0, cursor = 0, ok = true, badMsg = '';
  for (let c = 1; c <= nChunks; c++) {
    while (cursor + 1 < stscEntries.length && stscEntries[cursor + 1].firstChunk <= c) cursor++;
    const per = stscEntries[cursor].samplesPerChunk;
    let bytes = 0;
    for (let k = 0; k < per && sample < sizes.length; k++) bytes += sizes[sample++];
    const start = offsets[c - 1];
    if (start + bytes > mdatEnd) {
      ok = false;
      badMsg = ' -- chunk ' + c + ' overruns mdat (' + (start + bytes) + ' > ' + mdatEnd + ')';
      break;
    }
  }
  ck(ok, '[' + handle + '] every chunk byte-range fits inside mdat' + badMsg);
  ck(sample === nSamples,
    '[' + handle + '] stsc expands to exactly the declared sample count (' + sample + '/' + nSamples + ')');

  const last = offsets[nChunks - 1];
  const tail = sizes.slice(sample - stscEntries[stscEntries.length - 1].samplesPerChunk)
    .reduce((a, b) => a + b, 0);
  console.log('   last chunk @' + last + ', ends at ' + (last + tail) + ' (file ends ' + mdatEnd + ')');
});

/* duration */
const mvhd = found.find(f => f.type === 'mvhd');
const ver = buf.readUInt8(mvhd.offset + mvhd.header);
const base = mvhd.offset + mvhd.header + 4;
const ts = ver === 1 ? buf.readUInt32BE(base + 16) : buf.readUInt32BE(base + 8);
const dur = ver === 1 ? Number(buf.readBigUInt64BE(base + 20)) : buf.readUInt32BE(base + 12);
console.log('');
console.log('duration:', (dur / ts).toFixed(2) + 's (timescale ' + ts + ')');
ck(dur > 0, 'mvhd duration > 0');

console.log('');
console.log(problems.length
  ? 'RESULT: ' + problems.length + ' PROBLEM(S)'
  : 'RESULT: ALL CHECKS PASSED');
process.exit(problems.length ? 1 : 0);

