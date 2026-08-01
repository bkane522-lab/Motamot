# Motamot — PWA de traduction

## Structure
- `index.html` — interface (une seule page, vanilla HTML/CSS/JS)
- `api/translate.js` — fonction serverless Vercel (CommonJS) qui appelle Groq
- `manifest.json` + `sw.js` — installation en PWA + cache offline de l'interface
- `icons/` — favicon, icônes 192/512

## Déploiement (GitHub → Vercel, comme d'habitude)
1. Repo GitHub avec ces fichiers (le dossier `api/` DOIT être à la racine).
2. Vercel connecté au repo → déploiement automatique.
3. Project Settings → Environment Variables → `GROQ_API_KEY` = clé Groq.
4. Redéployer après ajout/modif de la variable.

## Fonctionnalités
- Traduction FR + 10 langues, détection auto de la langue source
- Mode **Naturel** (idiomatique) vs **Littéral** (mot à mot) — bascule au-dessus des panneaux
- **Import de fichier** — .txt et .docx gratuits ; **.pdf en premium** (voir plus bas)
- **Dictée vocale** — bouton micro, utilise la Web Speech API du navigateur (Chrome/Android)
- **Partage** — Web Share API si dispo, sinon copie presse-papier
- **Historique** — 30 dernières traductions, stocké en local sur l'appareil (`localStorage`,
  pas de compte ni de serveur — donc propre à chaque appareil/navigateur)
- **Raccourci Android** — appui long sur l'icône de l'app installée → "Nouvelle traduction"

## Freemium — import PDF
L'import PDF est verrouillé par défaut (badge "PDF" sur le bouton d'import). Au clic,
une modale demande une clé de licence Gumroad, vérifiée via `api/verify-license.js`
(appel à l'API officielle Gumroad `licenses/verify`). Une fois validée, le déblocage
est mémorisé sur l'appareil (`localStorage`).

**À faire avant déploiement :**
1. Créer un produit Gumroad (accès premium Motamot) et récupérer son *permalink*.
2. Dans `index.html`, remplacer `GUMROAD_PRODUCT_PERMALINK` et `GUMROAD_PRODUCT_URL`
   par les vraies valeurs (recherche `REMPLACER` dans le fichier).
3. Optionnel mais recommandé : sur Vercel, ajouter la variable d'environnement
   `GUMROAD_PRODUCT_PERMALINK` pour que le serveur impose le bon produit plutôt que
   de faire confiance à ce qu'envoie le navigateur.
4. Tester avec une clé de licence générée par un achat test Gumroad.

L'extraction de texte PDF se fait entièrement côté navigateur avec pdf.js (aucun
fichier n'est envoyé à un serveur).

## Limites connues
- L'historique est local à l'appareil : pas de synchronisation multi-appareils
  (possible plus tard avec Upstash Redis + un identifiant d'appareil, comme sur tes autres projets)
- La dictée vocale dépend du support navigateur (fonctionne sur Chrome Android, pas partout)
- 8000 caractères max par requête de traduction
- Pas de branding perso dans l'UI (conforme à ta règle habituelle)
