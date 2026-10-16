# Assets — CeceLove Landing Page

Déposez ici les médias du film :

| Fichier | Rôle | Statut |
|---------|------|--------|
| `hero caroussel/0.png` … `7.png` | 8 visuels du film, carrousel automatique du hero (également poster de la vidéo) | ✅ en place |
| `trailer.mp4` | Bande-annonce, utilisée en FR **et** en EN | ✅ en place |

> ⚠️ Le dossier s'écrit bien `hero caroussel` (un seul `r`, deux `s`). Les espaces sont
> encodés `%20` dans `index.html` → `./assets/hero%20caroussel/0.png`.

## Comportement si un fichier est manquant
- **Visuels manquants** : le dégradé + le visuel de secours « CeceLove » s'affichent automatiquement dans le hero.
- **Vidéo manquante** : le lecteur reste affiché avec le poster (le film se vend via le CTA).

## Formats conseillés
- Visuels du carrousel : PNG ou JPG, ratio **1:1** (carré) de préférence, ~900 × 900 px, < 400 Ko chacun.
  (Les 8 images actuelles font ~600 × 620 px, ratio ≈ 1:1 — parfait.)
- Bande-annonce : MP4 (H.264), ratio 16:9, 1080p, < 25 Mo pour un chargement rapide.
  (Le fichier actuel : MP4/H.264, 14,7 Mo ✅)

## ⚠️ Deux conditions pour pouvoir se déplacer dans la vidéo
1. **Le fichier** doit être « faststart » (voir plus bas).
2. **L'hébergeur** doit accepter les requêtes HTTP `Range` (répondre `206 Partial Content`
   avec l'en-tête `Accept-Ranges: bytes`).

Contrôle de la page **en ligne** (les deux conditions, plus les liens sortants) :

```powershell
node ../_tools/prod-check.js
# ou depuis cecelove-landing-page :  node _tools/prod-check.js
```

> 📌 Constat du 15/10/2026 : `cecelove.famatchai226.workers.dev` (assets statiques Cloudflare
> Workers) renvoie `200` même avec un en-tête `Range` → il ignore le téléchargement par morceaux.
> Conséquence **mesurée** (`_tools/mobile-seek-live.js`, Chrome + émulation Pixel 7 sur la page
> en ligne) : `video.seekable` reste `[[0, 0]]` et **tout** déplacement retombe à 0 s — même avec
> le fichier entièrement téléchargé (`buffered = [[0, 98.84]]`). Autrement dit : sur mobile, on ne
> peut ni avancer ni reculer, alors que la simple lecture fonctionne.
>
> **Correctif appliqué** : la bande-annonce est servie par un CDN qui gère `Range`
> → `https://cdn.jsdelivr.net/gh/famatchai226/CeceLove@main/assets/trailer.mp4`
> (`206` + `Accept-Ranges: bytes` + `Content-Type: video/mp4`) ; seek 90 % et 10 % vérifiés OK.
> L'URL est déclarée à **trois endroits qui doivent rester identiques** :
> la 1re balise `<source>` d'`index.html` et `trailer.src` dans `locales/fr.json` + `locales/en.json`
> (le script de langue remplace la source au chargement). Le 2e `<source>` local
> (`./assets/trailer.mp4`) sert de secours si le CDN est injoignable — ce repli, lui, n'est pas
> déplaçable (hôte sans `Range`).
>
> Limites de ce CDN : 20 Mo max par fichier (le trailer fait 14,7 Mo), dépôt public obligatoire,
> et `@main` est mis en cache (jusqu'à 7 jours) — après avoir remplacé la vidéo, purgez le cache
> jsDelivr ou épinglez un tag/commit dans l'URL. Solution définitive sans dépendance externe :
> servir le mp4 depuis **Cloudflare R2** (bucket public, `Range` natif) puis remettre l'URL R2
> dans `index.html` + `locales/*.json` (`_tools/check-links.js` contrôle les trois).

## ⚠️ La bande-annonce doit être « faststart »
Le lecteur doit pouvoir se déplacer dans la timeline **pendant** le téléchargement.
Pour cela l'atome `moov` du MP4 doit se trouver **avant** `mdat` :

| État | Conséquence |
|------|-------------|
| `moov` **avant** `mdat` (faststart) | lecture + déplacement immédiats, navigateur adaptatif ✅ |
| `moov` **après** `mdat` | Safari/iOS doit télécharger tout le fichier avant de pouvoir se déplacer ❌ |

`trailer.mp4` a été corrigé (faststart appliqué). Si vous remplacez la vidéo par une
nouvelle, refaites l'opération :

```powershell
# avec ffmpeg
ffmpeg -i nouvelle.mp4 -c copy -movflags +faststart trailer.mp4

# sans ffmpeg (script inclus dans le dépôt)
node ../_tools/mp4-faststart.js nouvelle.mp4 trailer.mp4
node ../_tools/mp4-verify.js trailer.mp4     # doit afficher FASTSTART OK + ALL CHECKS PASSED
```

## Ajouter / retirer un visuel du carrousel
Le carrousel se construit à partir des balises `<img class="slide">` du hero dans `index.html`
(dans `<div class="poster carousel" id="heroCarousel">`). Pour en ajouter une, copiez une ligne
existante et incrémentez le nom du fichier et le numéro dans l'`alt`. Les points de navigation
sont générés automatiquement — aucune autre modification n'est nécessaire.
