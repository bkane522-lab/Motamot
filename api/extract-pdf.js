// Fonction serverless Vercel — fine wrapper autour de lib/extractPdfHandler.js.
// L'extraction est réservée aux détenteurs d'un jeton premium valide (voir
// api/verify-license.js) : le PDF est envoyé en base64 et parsé ICI, côté
// serveur — impossible à débloquer en modifiant le JS du navigateur.
//
// Variables d'environnement :
//   LICENSE_SECRET               (obligatoire) même secret que verify-license.js
//   UPSTASH_REDIS_REST_URL / _TOKEN (recommandé) limitation de requêtes
//   ALLOWED_ORIGINS               (optionnel)
//
// Dépendance npm : pdf-parse (voir package.json) — Vercel l'installe
// automatiquement au déploiement.

const pdfParse = require('pdf-parse');
const { createExtractPdfHandler } = require('../lib/extractPdfHandler');

module.exports = createExtractPdfHandler({ pdfParseImpl: pdfParse });
