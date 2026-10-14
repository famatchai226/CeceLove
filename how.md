# CeceLove — Landing Page (Guide)

Landing page de vente du film **CeceLove** (1 500 FCFA).

## Structure du projet

```
cecelove-landing-page/
├── index.html      ← Page principale (thème sombre cinéma)
├── i18n.js         ← Script multilingue (FR / EN)
├── locales/
│   ├── fr.json     ← Traductions françaises
│   └── en.json     ← Traductions anglaises
├── assets/
│   ├── hero caroussel/  ← 8 visuels du hero (0.png … 7.png)
│   └── trailer.mp4      ← Bande-annonce (FR + EN)
├── .gitignore
└── how.md          ← Ce fichier
```

## Modifier les textes
- Éditez `locales/fr.json` pour le français.
- Éditez `locales/en.json` pour l'anglais.
- Les éléments d'`index.html` portent un attribut `data-i18n="section.cle"` (texte),
  `data-i18n-html` (HTML autorisé) ou `data-i18n-video` (source vidéo).

## Lien de paiement
Le checkout est externe et pointe vers :
`https://baltazar.mymaketou.shop/products/veux-un-film-pour-homme-mature/checkout`

Pour changer de lien, remplacez-le sur tous les boutons d'`index.html`
(nav, hero, CTA `#acheter`, float-bar, upsell).

## Médias
- **Hero** : carrousel automatique des 8 visuels `assets/hero caroussel/0.png` … `7.png`
  (rotation toutes les 3,8 s, points de navigation cliquables, pause au survol).
- **Bande-annonce** : `assets/trailer.mp4` (MP4 / H.264), utilisée en FR **et** en EN.
- Le premier visuel sert aussi de `poster` au lecteur vidéo.
- Un visuel de secours « CeceLove » s'affiche automatiquement si les images sont absentes.
- Détails et formats conseillés : `assets/README.md`.

### Ajouter / retirer un visuel du carrousel
Dans `index.html`, section hero, bloc `<div class="poster carousel" id="heroCarousel">` :
dupliquez une ligne `<img class="slide" src="./assets/hero%20caroussel/N.png" ... />`
en incrémentant `N`. Les points de navigation sont générés automatiquement par le script.

> ⚠️ Le dossier s'écrit `hero caroussel` (un seul `r`, deux `s`) et l'espace est encodé `%20`
> dans les URL (`hero%20caroussel`) pour rester valable sur tous les serveurs.

## Tester en local
Ouvrez simplement `index.html` dans un navigateur, **ou** lancez un petit serveur
(nécessaire pour que `fetch` des `locales/*.json` fonctionne) :

```powershell
cd "c:\Users\hp\Antigravity& Stitch\cecelove-landing-page"
python -m http.server 8080
# puis ouvrez http://localhost:8080
```

## Déploiement (GitHub + Cloudflare Pages)

1. Ouvrez votre terminal dans le dossier :
   `c:\Users\hp\Antigravity& Stitch\cecelove-landing-page`
2. **Préparer les fichiers** : `git add .`
3. **Enregistrer les changements** : `git commit -m "Nouvelle landing page CeceLove"`
4. **Envoyer sur GitHub** : `git push origin main`

*Le déploiement sur Cloudflare Pages se lancera automatiquement après le push.*

## Notes
- La page inclut une **barrière 18+** (age gate) bilingue, cohérente avec les autres pages.
- Le contenu est 100% statique : aucun build nécessaire.
