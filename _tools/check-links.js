/* Vérifie les liens de la page (upsell -> landing pages sœurs, boutons d'achat -> checkout)
   et la cohérence des fichiers de langue + du média.
   Usage: node _tools/check-links.js */
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

const anchors = [...html.matchAll(/<a href="(https?:\/\/[^"]+)"[\s\S]{0,200}?data-i18n="([^"]+)"/g)];
console.log('--- tous les CTA externes de la page (clé i18n -> URL) ---');
anchors.forEach(a => console.log('  ' + a[2].padEnd(18) + ' ' + a[1]));

/* Les boutons « upsell » renvoient vers la landing page dédiée du produit
   (même convention que kera- / gotelegram- / boutique-landing-page). */
const LANDING = {
  'upsell.balta_btn': 'https://balta.famatchai226.workers.dev/',
  'upsell.bd_btn': 'https://bd.famatchai226.workers.dev/'
};
/* Les boutons d'achat de cette page renvoient vers le checkout MyMaketou du film CeceLove. */
const CHECKOUT_URL = 'https://baltazar.mymaketou.shop/products/veux-un-film-pour-homme-mature/checkout';
const CHECKOUT = ['nav.cta', 'hero.cta', 'cta_section.btn', 'float_bar.btn'];

let problems = 0;
const ck = (ok, msg) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + msg); if (!ok) problems++; };
const has = (key, url) => { const f = anchors.find(a => a[2] === key); return !!f && f[1] === url; };
const show = key => { const f = anchors.find(a => a[2] === key); return f ? f[1] : 'INTROUVABLE'; };

console.log('');
console.log('--- upsell : landing pages des produits sœurs ---');
for (const [key, url] of Object.entries(LANDING)) {
  ck(has(key, url), key + ' -> ' + show(key) + (has(key, url) ? '' : '  (attendu : ' + url + ')'));
}

console.log('');
console.log('--- boutons d\'achat : checkout CeceLove ---');
for (const key of CHECKOUT) {
  ck(has(key, CHECKOUT_URL), key + ' -> ' + show(key) + (has(key, CHECKOUT_URL) ? '' : '  (attendu : ' + CHECKOUT_URL + ')'));
}

console.log('');
console.log('--- source de vérité : boutique-landing-page/how.md ---');
const doc = path.resolve(ROOT, '..', 'boutique-landing-page', 'how.md');
if (fs.existsSync(doc)) {
  const txt = fs.readFileSync(doc, 'utf8');
  for (const [key, url] of Object.entries(LANDING)) {
    ck(txt.includes(url), key + ' documenté dans how.md (' + url + ')');
  }
} else {
  console.log('  (non trouvé : ' + doc + ' — vérification ignorée)');
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
