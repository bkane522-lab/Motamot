// Fonction serverless Vercel (CommonJS) — traduction via Groq (llama-3.3-70b-versatile)
// Variable d'environnement requise sur Vercel : GROQ_API_KEY

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
    const { text, targetLang, sourceLang } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Texte manquant' });
      return;
    }
    if (!targetLang) {
      res.status(400).json({ error: 'Langue cible manquante' });
      return;
    }
    if (text.length > 8000) {
      res.status(400).json({ error: 'Texte trop long (8000 caractères max par requête)' });
      return;
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Clé API non configurée côté serveur' });
      return;
    }

    const sourceInstruction = sourceLang && sourceLang !== 'auto'
      ? `depuis le ${sourceLang}`
      : 'en détectant automatiquement la langue source';

    const systemPrompt =
      'Tu es un moteur de traduction professionnel. ' +
      'Tu réponds UNIQUEMENT avec le texte traduit, sans aucun commentaire, ' +
      'sans guillemets, sans explication, sans préambule. ' +
      'Tu conserves la mise en forme (retours à la ligne, ponctuation, style) du texte original. ' +
      'Tu préserves le ton (formel, familier, technique) du texte source.';

    const userPrompt =
      `Traduis le texte suivant vers le ${targetLang} ${sourceInstruction}.\n\n` +
      `Texte à traduire :\n${text}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Erreur Groq:', errText);
      res.status(502).json({ error: 'Erreur du service de traduction' });
      return;
    }

    const data = await groqResponse.json();
    const translated = data?.choices?.[0]?.message?.content?.trim();

    if (!translated) {
      res.status(502).json({ error: 'Réponse de traduction vide' });
      return;
    }

    res.status(200).json({ translation: translated });
  } catch (err) {
    console.error('Erreur serveur:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
