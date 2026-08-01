// Logique de /api/revise — "Révision intelligente" premium. Compare le texte
// original et sa traduction, et renvoie un JSON structuré (traduction
// révisée + corrections + avertissements + contrôles), jamais du texte libre.
//
// Toujours déclenchée à la demande explicite de l'utilisateur (bouton dédié),
// jamais automatiquement. Jeton premium signé vérifié AVANT tout appel Groq :
// un utilisateur gratuit ne déclenche jamais d'appel Groq via cette route.

const { verifyToken } = require('./licenseToken');
const { checkRateLimit } = require('./rateLimit');
const { applyCors } = require('./cors');
const { getClientIp } = require('./getClientIp');
const { parseRevisionResponse } = require('./parseRevisionResponse');

const MAX_REVISE_CHARS = 8000; // volontairement plus bas que la traduction : un 2e passage coûte déjà plus cher
const DEFAULT_RATE_LIMIT = 10; // configurable via env.REVISE_RATE_LIMIT
const RATE_WINDOW_SECONDS = 600;

const SYSTEM_PROMPT = `Tu es un réviseur bilingue professionnel.

Compare le texte original avec sa traduction.

Ta mission est de corriger uniquement ce qui est nécessaire afin de :
- préserver fidèlement le sens ;
- supprimer les contresens, omissions et ajouts injustifiés ;
- améliorer la fluidité, la grammaire et la ponctuation ;
- conserver le ton, le registre et le niveau de politesse ;
- préserver exactement les noms propres, chiffres, dates, montants, références et termes techniques ;
- signaler les ambiguïtés qui nécessitent une vérification humaine.

Vérifie explicitement : la fidélité du sens, les contresens, les omissions, les ajouts non justifiés,
la fluidité, la grammaire, la ponctuation, le niveau de politesse, le registre de langue, la cohérence
du ton, les noms propres, les chiffres, les dates, les montants, les références, les termes techniques
et les passages ambigus.

Préserve autant que possible : l'intention de l'auteur, la structure du message, les paragraphes,
les informations factuelles, les noms et valeurs numériques, le degré de familiarité ou de formalité.

N'invente aucune information. Ne modifie pas les faits. Ne rends pas le texte plus formel ou plus
familier sans raison. Conserve les paragraphes autant que possible.

Réponds UNIQUEMENT avec un objet JSON valide respectant exactement ce schéma, sans aucun texte autour :
{
  "revisedTranslation": "Texte révisé complet",
  "changesMade": ["Description courte d'une correction importante"],
  "warnings": ["Ambiguïté ou point nécessitant une vérification humaine"],
  "checks": {
    "meaningPreserved": true,
    "tonePreserved": true,
    "namesAndNumbersPreserved": true,
    "naturalLanguage": true
  }
}
changesMade et warnings peuvent être des tableaux vides s'il n'y a rien à signaler. Les quatre valeurs
de checks doivent être des booléens. Ne réponds jamais avec autre chose que ce JSON.`;

function buildUserPrompt({ originalText, translation, sourceLang, targetLang, mode }) {
  const sourceInfo = sourceLang && sourceLang !== 'auto' ? sourceLang : 'détectée automatiquement';
  const styleInfo = mode === 'litteral' ? 'littéral' : 'naturel';
  return [
    `Langue source : ${sourceInfo}`,
    `Langue cible : ${targetLang}`,
    `Style visé : ${styleInfo}`,
    '',
    `Texte original :\n${originalText}`,
    '',
    `Traduction à réviser :\n${translation}`,
  ].join('\n');
}

function createReviseHandler({ fetchImpl = fetch, env = process.env } = {}) {
  const rateLimit = Number(env.REVISE_RATE_LIMIT) > 0 ? Number(env.REVISE_RATE_LIMIT) : DEFAULT_RATE_LIMIT;

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
      // ---------- Authentification premium — vérifiée AVANT tout appel Groq ----------
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      const secret = env.LICENSE_SECRET;
      if (!secret) {
        res.status(500).json({ error: 'Secret de licence non configuré côté serveur.' });
        return;
      }

      const verification = verifyToken(token, secret);
      if (!verification.valid || verification.payload?.scope !== 'premium') {
        res.status(401).json({ error: 'La révision intelligente est une fonctionnalité premium (jeton absent, expiré ou invalide).' });
        return;
      }

      // ---------- Validation des entrées ----------
      const { originalText, translation, targetLang, sourceLang, mode } = req.body || {};

      if (!originalText || typeof originalText !== 'string' || !originalText.trim()) {
        res.status(400).json({ error: 'Texte original manquant.' });
        return;
      }
      if (!translation || typeof translation !== 'string' || !translation.trim()) {
        res.status(400).json({ error: 'Traduction à réviser manquante.' });
        return;
      }
      if (!targetLang || typeof targetLang !== 'string') {
        res.status(400).json({ error: 'Langue cible manquante.' });
        return;
      }
      if (originalText.length > MAX_REVISE_CHARS || translation.length > MAX_REVISE_CHARS) {
        res.status(400).json({
          error: `Ce texte est trop long pour la révision intelligente en une seule fois (${MAX_REVISE_CHARS} caractères max — un second passage coûte déjà plus cher qu'une traduction simple). Réserve la révision à des passages plus courts.`,
        });
        return;
      }

      const apiKey = env.GROQ_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'Clé API non configurée côté serveur.' });
        return;
      }

      // ---------- Rate limit dédié, distinct de la traduction et du PDF ----------
      try {
        const rl = await checkRateLimit({
          redisUrl: env.UPSTASH_REDIS_REST_URL,
          redisToken: env.UPSTASH_REDIS_REST_TOKEN,
          key: `revise:${getClientIp(req)}`,
          limit: rateLimit,
          windowSeconds: RATE_WINDOW_SECONDS,
          failOpenIfUnconfigured: true,
          fetchImpl,
        });
        if (!rl.allowed) {
          res.status(429).json({ error: `Trop de révisions intelligentes en peu de temps. Réessaie dans quelques minutes (limite : ${rateLimit} par 10 min).` });
          return;
        }
      } catch (rlErr) {
        console.error('Rate limit indisponible:', rlErr.message);
      }

      // ---------- Un seul appel Groq, explicitement demandé, réponse JSON stricte ----------
      const userPrompt = buildUserPrompt({ originalText, translation, sourceLang, targetLang, mode });

      let groqResponse;
      try {
        groqResponse = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.2,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
          }),
        });
      } catch (networkErr) {
        console.error('Erreur réseau vers Groq (revise):', networkErr);
        res.status(500).json({ error: 'Erreur serveur inattendue.' });
        return;
      }

      if (!groqResponse.ok) {
        const errText = await groqResponse.text().catch(() => '');
        console.error('Erreur Groq (revise):', groqResponse.status, errText);
        res.status(groqResponse.status === 429 ? 503 : 500).json({
          error: groqResponse.status === 429
            ? 'Le service de révision est temporairement surchargé, réessaie dans quelques instants.'
            : 'Erreur du service de révision.',
        });
        return;
      }

      const data = await groqResponse.json();
      const rawContent = data?.choices?.[0]?.message?.content;

      const parsedResult = parseRevisionResponse(rawContent);
      if (!parsedResult.valid) {
        console.error('Réponse de révision invalide:', parsedResult.error, '| brut:', rawContent);
        res.status(502).json({ error: 'La révision a renvoyé une réponse invalide, réessaie.' });
        return;
      }

      res.status(200).json(parsedResult.data);
    } catch (err) {
      console.error('Erreur serveur /api/revise:', err);
      res.status(500).json({ error: 'Erreur serveur inattendue.' });
    }
  };
}

module.exports = { createReviseHandler, MAX_REVISE_CHARS, DEFAULT_RATE_LIMIT, SYSTEM_PROMPT };
