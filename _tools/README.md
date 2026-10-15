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

`seek-probe.js` et `scrub-probe.js` sont les scripts injectés dans la page
(`Runtime.evaluate`) ; ils ne s'exécutent pas seuls.

## 4. `check-links.js` — liens de paiement & fichiers de langue
Liste tous les CTA de `index.html` (clé i18n → URL), vérifie que les deux boutons
d'upsell pointent vers les bons produits `mymaketou.shop`, que `fr.json` / `en.json`
sont valides et que la vidéo est bien en faststart.

```powershell
node _tools/check-links.js      # code de sortie 0 = tout est vert
```
