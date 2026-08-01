// Logique de /api/extract-pdf, extraite dans un module testable indépendamment
// (les dépendances externes — parseur PDF, Redis — sont injectables, ce qui
// permet de tester toute la logique d'autorisation/validation/erreurs sans
// réseau et sans la vraie librairie pdf-parse).

const { verifyToken } = require('./licenseToken');
const { checkRateLimit } = require('./rateLimit');
const { applyCors } = require('./cors');
const { getClientIp } = require('./getClientIp');

const MAX_PDF_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT = 15;
const RATE_WINDOW_SECONDS = 600;

// Un PDF valide commence par la signature "%PDF-" (éventuellement précédée
// de quelques octets de préambule chez certains générateurs). On la cherche
// dans les 1024 premiers octets plutôt qu'exiger une position exacte.
function hasPdfSignature(buffer) {
  return buffer.subarray(0, 1024).toString('latin1').includes('%PDF-');
}

// Distingue trois familles d'échec au parsing plutôt que de tout renvoyer
// comme "PDF corrompu" — un message générique qui, en production, s'est
// avéré trompeur : il apparaissait aussi pour des PDF valides quand le
// parseur lui-même ne se chargeait pas correctement (voir README).
async function runParser(pdfParseImpl, buffer) {
  try {
    return await pdfParseImpl(buffer);
  } catch (err) {
    // Journalisation volontairement limitée au diagnostic technique :
    // jamais le contenu du PDF, jamais de jeton. Le "stack" est inclus car
    // c'est la vraie erreur remontée par Vercel, essentielle pour diagnostiquer
    // en prod — il ne contient ni le fichier de l'utilisateur ni de secret.
    console.error('PDF extraction failed', {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    });

    if (err && err.code === 'PARSER_UNAVAILABLE') {
      const wrapped = new Error('Le service de lecture PDF est momentanément indisponible côté serveur.');
      wrapped.kind = 'parser_unavailable';
      throw wrapped;
    }

    const name = String(err?.name || '');
    const message = String(err?.message || '');
    // Motifs génériques + exceptions typiques de pdf.js (utilisé par unpdf) :
    // InvalidPDFException, PasswordException (PDF protégé — pas "corrompu"
    // à proprement parler, mais inexploitable sans mot de passe côté serveur),
    // UnexpectedResponseException.
    const looksMalformed = /invalid ?pdf|bad xref|malformed|unexpected end of file|no pdf header|xref/i.test(message)
      || /InvalidPDFException|UnexpectedResponseException/i.test(name);
    const looksPasswordProtected = /PasswordException/i.test(name) || /password/i.test(message);

    const wrapped = new Error(
      looksPasswordProtected
        ? 'Ce PDF est protégé par mot de passe — importe une version non protégée.'
        : looksMalformed
          ? 'Ce PDF est corrompu ou dans un format non supporté.'
          : "Le serveur n'a pas pu lire ce PDF. Essaie un autre PDF texte ou réessaie après le redéploiement."
    );
    wrapped.kind = looksPasswordProtected ? 'password' : looksMalformed ? 'malformed' : 'internal';
    throw wrapped;
  }
}

function createExtractPdfHandler({ pdfParseImpl, env = process.env }) {
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
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      const secret = env.LICENSE_SECRET;
      if (!secret) {
        res.status(500).json({ error: 'Secret de licence non configuré côté serveur.' });
        return;
      }

      const verification = verifyToken(token, secret);
      if (!verification.valid || verification.payload?.scope !== 'premium') {
        res.status(401).json({ error: 'Accès premium requis ou expiré (relance la vérification de licence).' });
        return;
      }

      const { fileBase64 } = req.body || {};
      if (!fileBase64 || typeof fileBase64 !== 'string') {
        res.status(400).json({ error: 'Fichier PDF manquant.' });
        return;
      }

      let buffer;
      try {
        buffer = Buffer.from(fileBase64, 'base64');
      } catch {
        res.status(400).json({ error: 'Fichier PDF illisible (encodage invalide).' });
        return;
      }

      if (buffer.length === 0) {
        res.status(400).json({ error: 'Fichier PDF vide.' });
        return;
      }
      if (buffer.length > MAX_PDF_BYTES) {
        res.status(400).json({
          error: `PDF trop volumineux (${(buffer.length / 1024 / 1024).toFixed(1)} Mo, 4 Mo max).`,
        });
        return;
      }
      if (!hasPdfSignature(buffer)) {
        res.status(400).json({ error: 'Ce fichier ne ressemble pas à un PDF valide (signature %PDF- absente).' });
        return;
      }

      try {
        const rl = await checkRateLimit({
          redisUrl: env.UPSTASH_REDIS_REST_URL,
          redisToken: env.UPSTASH_REDIS_REST_TOKEN,
          key: `extract-pdf:${getClientIp(req)}`,
          limit: RATE_LIMIT,
          windowSeconds: RATE_WINDOW_SECONDS,
          failOpenIfUnconfigured: true,
        });
        if (!rl.allowed) {
          res.status(429).json({ error: "Trop d'imports PDF en peu de temps. Réessaie dans quelques minutes." });
          return;
        }
      } catch (rlErr) {
        console.error('Rate limit indisponible:', rlErr.message);
      }

      let parsed;
      try {
        parsed = await runParser(pdfParseImpl, buffer);
      } catch (wrapped) {
        const status = wrapped.kind === 'malformed' || wrapped.kind === 'password' ? 422 : 500;
        res.status(status).json({ error: wrapped.message });
        return;
      }

      const text = (parsed.text || '').trim();
      if (!text) {
        res.status(422).json({
          error: "Aucun texte trouvé dans ce PDF — s'il s'agit d'un scan/image, l'extraction automatique ne fonctionne pas.",
        });
        return;
      }

      res.status(200).json({ text, pages: parsed.numpages || null });
    } catch (err) {
      console.error('Erreur serveur /api/extract-pdf:', err);
      res.status(500).json({ error: 'Erreur serveur inattendue.' });
    }
  };
}

module.exports = { createExtractPdfHandler, MAX_PDF_BYTES, hasPdfSignature };
