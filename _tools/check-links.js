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

/* La bande-annonce est servie par un CDN qui gère les requêtes HTTP Range : sans Range,
   `video.seekable` reste [[0, 0]] et avancer/reculer devient impossible sur mobile
   (cecelove.famatchai226.workers.dev répond 200 au lieu de 206 sur un Range).
   Le mp4 doit donc rester dans le dépôt public (source du CDN) et le fichier local en secours. */
const TRAILER_CDN = 'https://cdn.jsdelivr.net/gh/famatchai226/CeceLove@main/assets/trailer.mp4';
const TRAILER_LOCAL = './assets/trailer.mp4';
const TRAILER_CDN_MAX = 20 * 1024 * 1024; /* limite jsDelivr pour un fichier @gh */

const anchors = [...html.matchAll(/<a href="(https?:\/\/[^"]+)"[\s\S]{0,200}?data-i18n="([^"]+)"/g)];
console.log('--- tous les CTA externes de la page (clé i18n -> URL) ---');
anchors.forEach(a => console.log('  ' + a[2].padEnd(18) + ' ' + a[1]));

/* Les boutons « upsell » renvoient vers la landing page dédiée du produit
   (même convention que kera- / gotelegram- / boutique-landing-page).
   Règle produit : EXACTEMENT 3 cartes -> la boutique complète, CeceLove 2, Baltazar. */
const LANDING = {
  'upsell.shop_btn': 'https://boutique-landing-page.famatchai226.workers.dev/',
  'upsell.cece_btn': 'https://cecelove2.famatchai226.workers.dev/',
  'upsell.balta_btn': 'https://balta.famatchai226.workers.dev/'
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
/* règle produit : 3 cartes, pas une de plus, pas une de moins */
const upsellCards = [...html.matchAll(/<div class="upsell-card">([\s\S]*?)<\/div>/g)];
ck(upsellCards.length === 3, 'index.html : ' + upsellCards.length + ' carte(s) d\'upsell (exactement 3 attendues)');
ck(!/upsell\.bd_/.test(html), 'index.html : plus aucune carte BD dans l\'upsell');

/* Chaque carte d'upsell porte le visuel du produit, publié par le Worker de ce produit
   (URL absolue : rien à embarquer dans ce dossier). La carte « boutique complète » affiche
   une mosaïque 2 x 2 des couvertures du catalogue de la boutique. */
console.log('');
console.log('--- visuels des cartes d\'upsell ---');
const gridStart = html.indexOf('<div class="upsell-grid">');
const gridEnd = html.indexOf('</section>', gridStart);
const upsellBlock = gridStart >= 0 && gridEnd > gridStart ? html.slice(gridStart, gridEnd) : '';
const upsellImgs = [...upsellBlock.matchAll(/<img[^>]*>/g)].map(m => m[0]);
ck(upsellImgs.length === 6, 'index.html : ' + upsellImgs.length
  + ' visuel(s) dans les cartes (6 attendus : mosaïque 4 + 1 + 1)');
ck(upsellImgs.every(t => /\ssrc="https:\/\/[^"]+"/.test(t)),
  'visuels servis en URL absolue (aucun fichier à embarquer)');
ck(upsellImgs.every(t => /\salt="[^"]+"/.test(t)), 'visuels avec un texte alternatif');
ck(upsellImgs.every(t => /\sloading="lazy"/.test(t)), 'visuels en chargement différé (loading="lazy")');
for (const t of upsellImgs) console.log('  ' + (t.match(/src="([^"]+)"/) || [null, '?'])[1]);

console.log('');
console.log('--- boutons d\'achat : checkout CeceLove ---');
for (const key of CHECKOUT) {
  ck(has(key, CHECKOUT_URL), key + ' -> ' + show(key) + (has(key, CHECKOUT_URL) ? '' : '  (attendu : ' + CHECKOUT_URL + ')'));
}

console.log('');
console.log('--- source de vérité : boutique-landing-page/how.md ---');
const doc = path.resolve(ROOT, '..', 'boutique-landing-page', 'how.md');
/* le how.md de la boutique documente les URLs des produits du catalogue + sa propre URL ;
   la landing CeceLove n'est pas un produit du catalogue, elle n'y figure donc pas. */
const DOCUMENTED = ['upsell.shop_btn', 'upsell.balta_btn'];
if (fs.existsSync(doc)) {
  const txt = fs.readFileSync(doc, 'utf8');
  for (const key of DOCUMENTED) {
    const url = LANDING[key];
    ck(txt.includes(url), key + ' documenté dans how.md (' + url + ')');
  }
} else {
  console.log('  (non trouvé : ' + doc + ' — vérification ignorée)');
}

console.log('');
console.log('--- cohérence des fichiers de langue ---');
for (const lang of ['fr', 'en']) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang + '.json'), 'utf8'));
  ck(json.trailer && json.trailer.src === TRAILER_CDN,
    lang + '.json trailer.src = ' + (json.trailer && json.trailer.src));
  ck(!!(json.upsell && json.upsell.shop_btn && json.upsell.cece_btn && json.upsell.balta_btn),
    lang + '.json upsell : 3 cartes = boutique complète / CeceLove 2 / Baltazar');
}

console.log('');
console.log('--- média ---');
const mp4 = fs.readFileSync(path.join(ROOT, 'assets', 'trailer.mp4'));
const secondBox = mp4.toString('ascii', mp4.readUInt32BE(0) + 4, mp4.readUInt32BE(0) + 8);
ck(secondBox === 'moov', 'trailer.mp4 : second atome = ' + secondBox + ' (faststart)');
ck(html.includes('src="' + TRAILER_CDN + '"'), 'index.html : 1er <source> = CDN qui gère Range');
ck(html.includes('src="' + TRAILER_LOCAL + '"'), 'index.html : 2e <source> = secours ' + TRAILER_LOCAL);
ck(mp4.length < TRAILER_CDN_MAX, 'trailer.mp4 = ' + (mp4.length / 1048576).toFixed(1)
  + ' Mo (< 20 Mo, limite du CDN jsDelivr)');

console.log('');
console.log(problems ? 'RESULT: ' + problems + ' PROBLEM(S)' : 'RESULT: ALL CHECKS PASSED');
process.exit(problems ? 1 : 0);
