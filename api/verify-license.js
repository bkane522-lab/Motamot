// Fonction serverless Vercel (CommonJS) — vérifie une clé de licence Gumroad
// Aucune variable d'environnement obligatoire : le permalink produit est envoyé
// par le front, mais tu peux le forcer ici en dur si tu préfères le cacher côté serveur.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const { licenseKey, productPermalink } = req.body || {};

    if (!licenseKey) {
      res.status(400).json({ error: 'Clé de licence manquante' });
      return;
    }

    // Optionnel : forcer le permalink côté serveur plutôt que de faire confiance au front
    const permalink = process.env.GUMROAD_PRODUCT_PERMALINK || productPermalink;

    if (!permalink) {
      res.status(500).json({ error: 'Produit Gumroad non configuré' });
      return;
    }

    const params = new URLSearchParams({
      product_permalink: permalink,
      license_key: licenseKey,
    });

    const gumroadRes = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await gumroadRes.json();

    if (!gumroadRes.ok || !data.success) {
      res.status(400).json({ valid: false, error: 'Clé de licence invalide' });
      return;
    }

    res.status(200).json({ valid: true });
  } catch (err) {
    console.error('Erreur vérification licence:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
