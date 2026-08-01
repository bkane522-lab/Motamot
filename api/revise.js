// Fonction serverless Vercel — fine wrapper autour de lib/reviseHandler.js.
// "Révision intelligente" premium : compare texte source et traduction,
// renvoie un JSON structuré (traduction révisée + corrections + alertes +
// contrôles), jamais du texte libre. Toujours opt-in, jamais automatique,
// jamais gratuite (jeton premium signé requis, vérifié avant tout appel Groq).
//
// Variables d'environnement :
//   GROQ_API_KEY, LICENSE_SECRET (obligatoires)
//   UPSTASH_REDIS_REST_URL / _TOKEN, ALLOWED_ORIGINS (recommandés)
//   REVISE_RATE_LIMIT (optionnel — nombre de révisions/10min par IP, défaut 10)

const { createReviseHandler } = require('../lib/reviseHandler');

module.exports = createReviseHandler();
