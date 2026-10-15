/* Vérifie que les boutons upsell pointent bien vers les vrais produits et que les
   fichiers de langue sont cohérents. Usage: node _tools/_check-links.js */
const fs = require('fs');
const path = require('path');

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
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const anchors = [...html.matchAll(/<a href="([^"]*mymaketou[^"]*)"[\s\S]{0,200}?data-i18n="([^"]+)"/g)];
console.log('--- tous les CTA de la page (clé i18n -> URL) ---');
anchors.forEach(a => console.log('  ' + a[2].padEnd(20) + ' ' + a[1]));

const EXPECT = {
  'upsell.balta_btn': '/products/veux-tu-1385-video-289-photo-260-bd-video-baltazar-et-du-petit-baltazar-inclu/checkout',
  'upsell.bd_btn': '/products/veut-tu-14838-pdf-bd-hentai-pour-homme-mature-/checkout'
};

let problems = 0;
const ck = (ok, msg) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + msg); if (!ok) problems++; };

console.log('');
console.log('--- boutons upsell du bas de page ---');
for (const [key, url] of Object.entries(EXPECT)) {
  const found = anchors.find(a => a[2] === key);
  ck(!!found && found[1].endsWith(url), key + ' -> ' + (found ? found[1] : 'INTROUVABLE'));
}

console.log('');
console.log('--- cohérence des fichiers de langue ---');
for (const lang of ['fr', 'en']) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang + '.json'), 'utf8'));
  ck(json.trailer && json.trailer.src === './assets/trailer.mp4',
    lang + '.json trailer.src = ' + (json.trailer && json.trailer.src));
  ck(!!(json.upsell && json.upsell.balta_btn && json.upsell.bd_btn),
    lang + '.json upsell : "' + json.upsell.balta_btn + '" / "' + json.upsell.bd_btn + '"');
}

console.log('');
console.log('--- média ---');
const mp4 = fs.readFileSync(path.join(ROOT, 'assets', 'trailer.mp4'));
const secondBox = mp4.toString('ascii', mp4.readUInt32BE(0) + 4, mp4.readUInt32BE(0) + 8);
ck(secondBox === 'moov', 'trailer.mp4 : second atome = ' + secondBox + ' (faststart)');

console.log('');
console.log(problems ? 'RESULT: ' + problems + ' PROBLEM(S)' : 'RESULT: ALL CHECKS PASSED');
process.exit(problems ? 1 : 0);
