# `_tools` — scripts de vérification (dev)

Outils maison utilisés pour valider la page **CeceLove**. Aucun n'est nécessaire au
fonctionnement du site : ils servent à contrôler les médias et le comportement du
lecteur vidéo avant mise en ligne.

> Les commandes ci-dessous se lancent **depuis le dossier `cecelove-landing-page`** :
> `cd "c:\Users\hp\Antigravity& Stitch\cecelove-landing-page"`

## 1. `mp4-faststart.js` — rendre une vidéo lisible en streaming
Déplace l'atome `moov` **avant** `mdat` (l'équivalent de `ffmpeg -movflags +faststart`,
implémenté en Node : pas besoin de ffmpeg) et corrige toutes les tables d'offsets
(`stco` / `co64`) du décalage correspondant.

```powershell
node _tools/mp4-faststart.js assets/nouvelle-video.mp4 assets/trailer.mp4
```

> ⚠️ Un MP4 avec `moov` à la fin ne peut pas être « scrubé » proprement : Safari/iOS
> doit télécharger **tout** le fichier avant de pouvoir se déplacer dans la timeline.
> C'était le cas de `assets/trailer.mp4` → corrigé.

## 2. `mp4-verify.js` — contrôle structurel
Vérifie l'ordre des atomes (faststart), et pour chaque piste : nombre de chunks,
offsets strictement croissants, plage d'octets de chaque chunk à l'intérieur du `mdat`,
cohérence `stsc` + `stsz` + `stco`, durée.

```powershell
node _tools/mp4-verify.js assets/trailer.mp4
```
Code de sortie `0` = tout est vert.

## 3. `seek-test-cecelove.js` — test navigateur réel (bout en bout)
Monte un serveur statique local (avec support HTTP `Range` et **débit limité**), pilote
Chrome headless via le DevTools Protocol, ouvre la vraie page `index.html` et :
1. ferme l'age gate 18+ comme un visiteur,
2. teste 5 seeks sur la timeline (en pause) + 1 seek **pendant la lecture**,
3. vérifie via `elementFromPoint` que rien ne recouvre le lecteur,
4. clique **réellement** sur la barre de progression et vérifie que `currentTime` bouge,
5. mesure le nombre d'octets réellement servis.

```powershell
node _tools/seek-test-cecelove.js                  # 1200 Ko/s par défaut
node _tools/seek-test-cecelove.js --throttle=600    # réseau plus lent
node _tools/seek-test-cecelove.js "C:\chemin\chrome.exe"
```
Code de sortie `0` = la vidéo se scrube correctement.

> ⚠️ Le serveur local de ce test **supporte** `Range` (comme la plupart des serveurs).
> Si la page en ligne est servie par un hébergeur qui l'ignore, le seek restera dégradé
> en production même si ce test passe : vérifier avec `node _tools/prod-check.js`.

`seek-probe.js` et `scrub-probe.js` sont les scripts injectés dans la page
(`Runtime.evaluate`) ; ils ne s'exécutent pas seuls.

## 4. `check-links.js` — liens sortants & fichiers de langue
Liste tous les CTA externes d'`index.html` (clé i18n → URL) et vérifie :
- les **boutons d'upsell** → landing pages des produits sœurs
  (`balta.famatchai226.workers.dev`, `bd.famatchai226.workers.dev`), croisées avec
  la source de vérité `../boutique-landing-page/how.md` ;
- les **4 boutons d'achat** → checkout MyMaketou du film CeceLove ;
- `fr.json` / `en.json` valides + vidéo bien en faststart.

```powershell
node _tools/check-links.js      # code de sortie 0 = tout est vert
```

## 5. `prod-check.js` — contrôle de la page EN LIGNE
Interroge l'URL déployée (par défaut `https://cecelove.famatchai226.workers.dev/`) et vérifie :
1. la page répond `200` ;
2. les 6 CTA de la version en ligne pointent sur les bonnes cibles
   (upsell → landing pages sœurs, achat → checkout) ;
3. `assets/trailer.mp4` est bien servi en **faststart** ;
4. le serveur accepte les requêtes **`Range`** (`206` + `Accept-Ranges: bytes`),
   condition indispensable pour se déplacer dans la vidéo pendant la lecture.

```powershell
node _tools/prod-check.js
node _tools/prod-check.js https://autre-domaine.example/
```
Code de sortie `1` si la page ou un lien est cassé. Une absence de support `Range`
sort en `WARN` (c'est un problème d'hébergement, pas de la page) avec les pistes de correction.
