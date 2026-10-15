/* Contrôle de la page EN LIGNE (production) :
   1. la page répond 200 ;
   2. les 6 CTA ont les bonnes cibles (upsell -> landing pages, achat -> checkout) ;
   3. la bande-annonce est servie en faststart ET le serveur accepte les requêtes HTTP `Range`
      (indispensable pour se déplacer dans la vidéo pendant la lecture).

   Usage:
     node _tools/prod-check.js
     node _tools/prod-check.js https://cecelove.famatchai226.workers.dev/
*/
const BASE = (process.argv[2] || 'https://cecelove.famatchai226.workers.dev/').replace(/\/?$/, '/');

const CHECKOUT = 'https://baltazar.mymaketou.shop/products/veux-un-film-pour-homme-mature/checkout';
const LANDING = {
  'upsell.balta_btn': 'https://balta.famatchai226.workers.dev/',
  'upsell.bd_btn': 'https://bd.famatchai226.workers.dev/'
};

let fail = 0;
let warn = 0;
const pass = msg => console.log('PASS  ' + msg);
const ko = msg => { fail++; console.log('FAIL  ' + msg); };
const ww = msg => { warn++; console.log('WARN  ' + msg); };

(async () => {
  console.log('Cible : ' + BASE);

  console.log('');
  console.log('--- 1. la page repond ---');
  const page = await fetch(BASE, { redirect: 'follow' });
  const html = await page.text();
  if (page.ok) pass('index.html -> HTTP ' + page.status + ' (' + html.length + ' caracteres)');
  else ko('index.html -> HTTP ' + page.status);

  console.log('');
  console.log('--- 2. liens sortants ---');
  const href = key => {
    const m = html.match(new RegExp('<a href="([^"]+)"[\\s\\S]{0,200}?data-i18n="' + key.replace('.', '\\.') + '"'));
    return m ? m[1] : null;
  };
  for (const [key, url] of Object.entries(LANDING)) {
    const got = href(key);
    if (got === url) pass(key + ' -> ' + got);
    else ko(key + ' -> ' + got + '  (attendu : ' + url + ')');
  }
  for (const key of ['nav.cta', 'hero.cta', 'cta_section.btn', 'float_bar.btn']) {
    const got = href(key);
    if (got === CHECKOUT) pass(key + ' -> checkout');
    else ko(key + ' -> ' + got + '  (attendu : ' + CHECKOUT + ')');
  }

  console.log('');
  console.log('--- 3. bande-annonce : faststart + Range ---');
  const url = BASE + 'assets/trailer.mp4';
  const res = await fetch(url, { headers: { Range: 'bytes=0-63' } });
  const rangeOk = res.status === 206;
  const acceptRanges = res.headers.get('accept-ranges');
  const contentRange = res.headers.get('content-range');
  const type = res.headers.get('content-type');
  const reader = res.body.getReader();
  const first = await reader.read();
  const buf = Buffer.from(first.value.slice(0, 64));
  await reader.cancel().catch(() => {});
  const firstSize = buf.readUInt32BE(0);
  const atom1 = buf.toString('ascii', 4, 8);
  const atom2 = buf.toString('ascii', firstSize + 4, firstSize + 8);
  if (type && type.includes('video/mp4')) pass('content-type = ' + type);
  else ko('content-type = ' + type + ' (attendu video/mp4)');
  if (atom2 === 'moov') pass('atomes : ' + atom1 + ' puis ' + atom2 + ' -> faststart OK');
  else ko('atomes : ' + atom1 + ' puis ' + atom2 + ' -> PAS faststart');
  if (rangeOk && acceptRanges && acceptRanges.includes('bytes')) {
    pass('Range supporte : HTTP 206' + (contentRange ? ' (' + contentRange + ')' : ''));
  } else {
    ww('Range NON supporte : HTTP ' + res.status + ' | accept-ranges=' + acceptRanges +
      ' | content-range=' + contentRange);
    console.log('      -> le navigateur ne peut pas telecharger la video par morceaux : le seek');
    console.log('         reste limite a ce qui est deja bufferise (critique sur Safari/iOS).');
    console.log('         Heberger le mp4 sur un service qui renvoie 206 (ex. Cloudflare R2,');
    console.log('         bucket public) ou activer le support Range sur l\'hebergeur actuel.');
  }

  console.log('');
  console.log(fail || warn
    ? 'RESULT: ' + fail + ' FAIL / ' + warn + ' WARN'
    : 'RESULT: ALL CHECKS PASSED');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERREUR : ' + e.message); process.exit(1); });
