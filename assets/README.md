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

## Ajouter / retirer un visuel du carrousel
Le carrousel se construit à partir des balises `<img class="slide">` du hero dans `index.html`
(dans `<div class="poster carousel" id="heroCarousel">`). Pour en ajouter une, copiez une ligne
existante et incrémentez le nom du fichier et le numéro dans l'`alt`. Les points de navigation
sont générés automatiquement — aucune autre modification n'est nécessaire.
