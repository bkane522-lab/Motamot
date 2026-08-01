// Logique de /api/translate, extraite pour être testable (fetch injectable).

const { chunkText } = require('./chunkText');
const { checkRateLimit } = require('./rateLimit');
const { applyCors } = require('./cors');
const { getClientIp } = require('./getClientIp');

const MAX_TEXT_CHARS = 20000;
const CHUNK_SIZE = 3500;
const MAX_CHUNKS_PER_REQUEST = 8;
const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 600;

async function translateChunk({ apiKey, text, targetLang, sourceInstruction, styleInstruction, fetchImpl }) {
  const systemPrompt =
    'Tu es un moteur de traduction professionnel. ' +
    'Tu réponds UNIQUEMENT avec le texte traduit, sans aucun commentaire, ' +
    'sans guillemets, sans explication, sans préambule. ' +
    'Tu conserves la mise en forme (retours à la ligne, ponctuation, style) du texte original. ' +
    'Tu préserves le ton (formel, familier, technique) du texte source. ' +
    styleInstruction;

  const userPrompt =
    `Traduis le texte suivant vers le ${targetLang} ${sourceInstruction}.\n\n` +
    `Texte à traduire :\n${text}`;

  const groqResponse = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    console.error('Erreur Groq:', groqResponse.status, errText);
    const err = new Error(
      groqResponse.status === 429
        ? 'Le service de traduction est temporairement surchargé, réessaie dans quelques instants.'
        : 'Erreur du service de traduction.'
    );
    err.upstreamStatus = groqResponse.status;
    throw err;
  }

  const data = await groqResponse.json();
  const translated = data?.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error('Réponse de traduction vide.');
  return translated;
}

function createTranslateHandler({ fetchImpl = fetch, env = process.env } = {}) {
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
      const { text, targetLang, sourceLang, mode } = req.body || {};

      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'Texte manquant.' });
        return;
      }
      if (!targetLang || typeof targetLang !== 'string') {
        res.status(400).json({ error: 'Langue cible manquante.' });
        return;
      }
      if (text.length > MAX_TEXT_CHARS) {
        res.status(400).json({
          error: `Texte trop long (${text.length} caractères, ${MAX_TEXT_CHARS} max par requête). Coupe-le en plusieurs parties.`,
        });
        return;
      }

      const apiKey = env.GROQ_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'Clé API de traduction non configurée côté serveur.' });
        return;
      }

      try {
        const rl = await checkRateLimit({
          redisUrl: env.UPSTASH_REDIS_REST_URL,
          redisToken: env.UPSTASH_REDIS_REST_TOKEN,
          key: `translate:${getClientIp(req)}`,
          limit: RATE_LIMIT,
          windowSeconds: RATE_WINDOW_SECONDS,
          failOpenIfUnconfigured: true,
          fetchImpl,
        });
        if (!rl.allowed) {
          res.status(429).json({
            error: `Trop de traductions en peu de temps. Réessaie dans quelques minutes (limite : ${RATE_LIMIT} par 10 min).`,
          });
          return;
        }
      } catch (rlErr) {
        console.error('Rate limit indisponible:', rlErr.message);
      }

      const chunks = chunkText(text, CHUNK_SIZE);

      if (chunks.length > MAX_CHUNKS_PER_REQUEST) {
        res.status(400).json({
          error: `Ce texte demande ${chunks.length} morceaux à traduire, au-delà de la limite de ${MAX_CHUNKS_PER_REQUEST} par requête (contrainte de temps d'exécution du serveur). Raccourcis le texte ou fais plusieurs traductions.`,
        });
        return;
      }

      const sourceInstruction = sourceLang && sourceLang !== 'auto'
        ? `depuis le ${sourceLang}`
        : 'en détectant automatiquement la langue source';

      const styleInstruction = mode === 'litteral'
        ? 'Tu privilégies une traduction LITTÉRALE, au plus proche de la structure et du choix des mots du texte source, même si le résultat est moins fluide.'
        : "Tu privilégies une traduction NATURELLE et idiomatique, comme l'écrirait un locuteur natif, plutôt qu'un calque mot à mot.";

      const translatedChunks = [];
      for (const chunk of chunks) {
        const translated = await translateChunk({
          apiKey, text: chunk, targetLang, sourceInstruction, styleInstruction, fetchImpl,
        });
        translatedChunks.push(translated);
      }

      res.status(200).json({
        translation: translatedChunks.join('\n\n'),
        chunked: chunks.length > 1,
        chunkCount: chunks.length,
      });
    } catch (err) {
      console.error('Erreur serveur /api/translate:', err);
      res.status(err.upstreamStatus === 429 ? 503 : 500).json({
        error: err.message || 'Erreur serveur inattendue.',
      });
    }
  };
}

module.exports = { createTranslateHandler, MAX_TEXT_CHARS, CHUNK_SIZE, MAX_CHUNKS_PER_REQUEST };
