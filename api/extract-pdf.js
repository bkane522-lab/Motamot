// Fonction serverless Vercel — fine wrapper autour de lib/extractPdfHandler.js.
// L'extraction est réservée aux détenteurs d'un jeton premium valide (voir
// api/verify-license.js) : le PDF est envoyé en base64 et parsé ICI, côté
// serveur — impossible à débloquer en modifiant le JS du navigateur.
//
// PARSEUR : unpdf (remplace pdf-parse, voir README pour le pourquoi du
// changement). unpdf est un package ESM-only conçu pour les environnements
// serverless/edge — pas d'accès filesystem, pas de mode debug caché, basé
// sur pdf.js. On le charge via import() dynamique (fonctionne depuis un
// fichier CommonJS sans changer le "type" du projet).
//
// Variables d'environnement :
//   LICENSE_SECRET               (obligatoire) même secret que verify-license.js
//   UPSTASH_REDIS_REST_URL / _TOKEN (recommandé) limitation de requêtes
//   ALLOWED_ORIGINS               (optionnel)
//
// Dépendance npm : unpdf (voir package.json) — Vercel l'installe
// automatiquement au déploiement.

const { createExtractPdfHandler } = require('../lib/extractPdfHandler');

let unpdfModulePromise = null;

function loadUnpdf() {
  if (!unpdfModulePromise) {
    unpdfModulePromise = import('unpdf').catch((err) => {
      console.error('unpdf indisponible au chargement', {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
      });
      return null;
    });
  }
  return unpdfModulePromise;
}

async function pdfParseImpl(buffer) {
  const unpdf = await loadUnpdf();
  if (!unpdf) {
    const err = new Error('unpdf indisponible côté serveur');
    err.code = 'PARSER_UNAVAILABLE';
    throw err;
  }

  const { getDocumentProxy, extractText } = unpdf;
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  return {
    text: Array.isArray(text) ? text.join('\n\n') : text,
    numpages: totalPages,
  };
}

module.exports = createExtractPdfHandler({ pdfParseImpl });
