// Fonction serverless Vercel — fine wrapper autour de lib/extractPdfHandler.js.
// L'extraction est réservée aux détenteurs d'un jeton premium valide (voir
// api/verify-license.js) : le PDF est envoyé en base64 et parsé ICI, côté
// serveur — impossible à débloquer en modifiant le JS du navigateur.
//
// BUG CORRIGÉ (production) : `require('pdf-parse')` chargeait le point
// d'entrée index.js du package, qui contient un bloc de "mode debug"
// déclenché quand `module.parent` est vide :
//   let isDebugMode = !module.parent;
//   if (isDebugMode) { let PDF_FILE = './test/data/05-versions-space.pdf'; ... }
// Avec le bundling serverless de Vercel (esbuild/ncc), `module.parent` est
// souvent vide même pour un require() tout à fait normal — le package
// tentait alors de lire un fichier de test absent du déploiement, ce qui
// échouait pour TOUT PDF, y compris des PDF texte parfaitement valides, et
// remontait comme une erreur générique "corrompu ou non supporté".
// Fix : on importe directement l'implémentation interne du package
// (lib/pdf-parse.js), qui ne contient pas ce bloc de debug.
//
// Variables d'environnement :
//   LICENSE_SECRET               (obligatoire) même secret que verify-license.js
//   UPSTASH_REDIS_REST_URL / _TOKEN (recommandé) limitation de requêtes
//   ALLOWED_ORIGINS               (optionnel)
//
// Dépendance npm : pdf-parse (voir package.json) — Vercel l'installe
// automatiquement au déploiement.

const { createExtractPdfHandler } = require('../lib/extractPdfHandler');

function loadPdfParseImplementation() {
  try {
    // Contourne index.js et son bloc de debug — implémentation directe.
    return require('pdf-parse/lib/pdf-parse.js');
  } catch (primaryErr) {
    try {
      // Filet de sécurité si la structure interne du package change un jour.
      return require('pdf-parse');
    } catch (fallbackErr) {
      console.error('pdf-parse indisponible au chargement', {
        name: fallbackErr?.name,
        message: fallbackErr?.message,
        code: fallbackErr?.code,
      });
      return null;
    }
  }
}

const pdfParseRaw = loadPdfParseImplementation();

async function pdfParseImpl(buffer) {
  if (!pdfParseRaw) {
    const err = new Error('pdf-parse indisponible côté serveur');
    err.code = 'PARSER_UNAVAILABLE';
    throw err;
  }
  return pdfParseRaw(buffer);
}

module.exports = createExtractPdfHandler({ pdfParseImpl });
