// Logique de /api/verify-license, extraite pour être testable (fetch injectable).

const { signToken } = require('./licenseToken');
const { checkRateLimit } = require('./rateLimit');
const { applyCors } = require('./cors');
const { getClientIp } = require('./getClientIp');

const TOKEN_VALIDITY_MS = 1000 * 60 * 60 * 24 * 90; // 90 jours
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 600;

function createVerifyLicenseHandler({ fetchImpl = fetch, env = process.env } = {}) {
  return async function handler(req, res) {
    applyCors(req, res, env.ALLOWED_ORIGINS);

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Méthode non autorisée.' });
      return;
    }

    try {
      const { licenseKey, productPermalink } = req.body || {};

      if (!licenseKey || typeof licenseKey !== 'string') {
        res.status(400).json({ error: 'Clé de licence manquante.' });
        return;
      }

      try {
        const rl = await checkRateLimit({
          redisUrl: env.UPSTASH_REDIS_REST_URL,
          redisToken: env.UPSTASH_REDIS_REST_TOKEN,
          key: `verify-license:${getClientIp(req)}`,
          limit: RATE_LIMIT,
          windowSeconds: RATE_WINDOW_SECONDS,
          failOpenIfUnconfigured: true,
          fetchImpl,
        });
        if (!rl.allowed) {
          res.status(429).json({ error: 'Trop de tentatives de vérification. Réessaie dans quelques minutes.' });
          return;
        }
      } catch (rlErr) {
        console.error('Rate limit indisponible:', rlErr.message);
      }

      const permalink = env.GUMROAD_PRODUCT_PERMALINK || productPermalink;
      if (!permalink) {
        res.status(500).json({ error: 'Produit Gumroad non configuré côté serveur.' });
        return;
      }

      const secret = env.LICENSE_SECRET;
      if (!secret) {
        res.status(500).json({ error: 'Secret de signature non configuré côté serveur (LICENSE_SECRET).' });
        return;
      }

      const params = new URLSearchParams({ product_permalink: permalink, license_key: licenseKey });

      const gumroadRes = await fetchImpl('https://api.gumroad.com/v2/licenses/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await gumroadRes.json().catch(() => ({}));

      if (!gumroadRes.ok || !data.success) {
        res.status(400).json({ valid: false, error: 'Clé de licence invalide.' });
        return;
      }

      const token = signToken({ exp: Date.now() + TOKEN_VALIDITY_MS, scope: 'premium' }, secret);

      res.status(200).json({ valid: true, token, expiresAt: Date.now() + TOKEN_VALIDITY_MS });
    } catch (err) {
      console.error('Erreur vérification licence:', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

module.exports = { createVerifyLicenseHandler, TOKEN_VALIDITY_MS };
