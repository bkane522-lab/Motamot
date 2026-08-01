// Parsing + validation stricte de la réponse JSON attendue du modèle pour la
// révision intelligente. Fonction pure, testable sans réseau : c'est ce qui
// permet de garantir "jamais de JSON brut affiché à l'utilisateur" — si ça ne
// correspond pas exactement au schéma, on rejette proprement plutôt que de
// laisser passer un format inattendu vers l'interface.

const REQUIRED_CHECK_KEYS = ['meaningPreserved', 'tonePreserved', 'namesAndNumbersPreserved', 'naturalLanguage'];

function extractJsonSubstring(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * @param {string} raw - contenu brut renvoyé par le modèle
 * @returns {{ valid: true, data: object } | { valid: false, error: string }}
 */
function parseRevisionResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'Réponse de révision vide.' };
  }

  let parsed = null;

  // 1er essai : la réponse est du JSON pur.
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 2e essai : le modèle a entouré le JSON de texte (préambule, explication...).
    const substring = extractJsonSubstring(raw);
    if (substring) {
      try {
        parsed = JSON.parse(substring);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Réponse de révision illisible (JSON invalide).' };
  }

  if (typeof parsed.revisedTranslation !== 'string' || !parsed.revisedTranslation.trim()) {
    return { valid: false, error: 'Réponse de révision incomplète (traduction révisée manquante).' };
  }

  const changesMade = Array.isArray(parsed.changesMade)
    ? parsed.changesMade.filter((x) => typeof x === 'string')
    : [];

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((x) => typeof x === 'string')
    : [];

  if (!parsed.checks || typeof parsed.checks !== 'object' || Array.isArray(parsed.checks)) {
    return { valid: false, error: 'Réponse de révision incomplète (contrôles manquants).' };
  }

  const checks = {};
  for (const key of REQUIRED_CHECK_KEYS) {
    if (typeof parsed.checks[key] !== 'boolean') {
      return { valid: false, error: `Réponse de révision incomplète (contrôle "${key}" manquant ou invalide).` };
    }
    checks[key] = parsed.checks[key];
  }

  return {
    valid: true,
    data: {
      revisedTranslation: parsed.revisedTranslation.trim(),
      changesMade,
      warnings,
      checks,
    },
  };
}

module.exports = { parseRevisionResponse, REQUIRED_CHECK_KEYS };
