// Pose des en-têtes CORS restreints. Sans ça, l'API précédente répondait
// Access-Control-Allow-Origin: * — n'importe quel site tiers pouvait appeler
// tes fonctions serverless depuis le navigateur d'un visiteur et consommer
// ton quota Groq/Upstash à ta place. Les appels same-origin (ton propre
// front) ne sont de toute façon jamais bloqués par CORS, donc restreindre
// ici n'a aucun coût fonctionnel pour l'app elle-même.

function applyCors(req, res, allowedOriginsEnv) {
  const allowed = (allowedOriginsEnv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers?.origin;

  if (allowed.length === 0) {
    // Pas de liste configurée : on ne pose pas d'en-tête ACAO du tout.
    // Les requêtes same-origin marchent toujours ; les requêtes cross-origin
    // depuis un navigateur seront bloquées par le navigateur lui-même.
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = { applyCors };
