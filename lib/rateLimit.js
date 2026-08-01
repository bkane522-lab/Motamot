// Limitation de requêtes par IP, fenêtre fixe, via l'API REST d'Upstash Redis
// (même stack que les autres projets). Utilise fetch (global, Node >= 18).
//
// IMPORTANT — comportement par défaut si Upstash n'est pas configuré :
// on choisit de FERMER (fail-closed) plutôt que d'ouvrir, pour éviter qu'un
// oubli de configuration ne désactive silencieusement toute limitation.
// Passe `failOpenIfUnconfigured: true` explicitement si tu préfères l'inverse
// pendant le développement.

async function checkRateLimit({
  redisUrl,
  redisToken,
  key,
  limit,
  windowSeconds,
  failOpenIfUnconfigured = false,
  fetchImpl = fetch,
}) {
  if (!redisUrl || !redisToken) {
    return {
      allowed: failOpenIfUnconfigured,
      remaining: failOpenIfUnconfigured ? limit : 0,
      configured: false,
    };
  }

  const bucketKey = `ratelimit:${key}`;

  const incrRes = await fetchImpl(`${redisUrl}/incr/${encodeURIComponent(bucketKey)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
  });
  if (!incrRes.ok) {
    throw new Error(`Upstash INCR a échoué (${incrRes.status})`);
  }
  const incrData = await incrRes.json();
  const count = incrData.result;

  if (count === 1) {
    // Première requête de la fenêtre : on pose l'expiration.
    await fetchImpl(`${redisUrl}/expire/${encodeURIComponent(bucketKey)}/${windowSeconds}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
    });
  }

  const allowed = count <= limit;
  return { allowed, remaining: Math.max(0, limit - count), configured: true, count };
}

module.exports = { checkRateLimit };
