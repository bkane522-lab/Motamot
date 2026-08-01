// Fonction serverless Vercel — fine wrapper autour de lib/translateHandler.js.
//
// Variables d'environnement :
//   GROQ_API_KEY              (obligatoire) clé Groq — jamais exposée au client
//   UPSTASH_REDIS_REST_URL    (recommandé)  pour la limitation de requêtes
//   UPSTASH_REDIS_REST_TOKEN  (recommandé)
//   ALLOWED_ORIGINS           (optionnel)   liste d'origines autorisées, séparées par des virgules

const { createTranslateHandler } = require('../lib/translateHandler');

module.exports = createTranslateHandler();
