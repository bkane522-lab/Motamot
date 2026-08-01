// Fonction serverless Vercel — fine wrapper autour de lib/verifyLicenseHandler.js.
//
// Variables d'environnement :
//   LICENSE_SECRET               (obligatoire) secret de signature des jetons
//   GUMROAD_PRODUCT_ID           (obligatoire) identifiant API du produit Gumroad
//   UPSTASH_REDIS_REST_URL / _TOKEN (recommandé) limitation de requêtes
//   ALLOWED_ORIGINS               (optionnel)

const { createVerifyLicenseHandler } = require('../lib/verifyLicenseHandler');

module.exports = createVerifyLicenseHandler();
