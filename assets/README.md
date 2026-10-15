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
