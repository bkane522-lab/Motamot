const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRevisionResponse } = require('../lib/parseRevisionResponse');

const validPayload = {
  revisedTranslation: 'Bonjour le monde.',
  changesMade: ['Correction d\'un contresens sur "world"'],
  warnings: [],
  checks: { meaningPreserved: true, tonePreserved: true, namesAndNumbersPreserved: true, naturalLanguage: true },
};

test('réponse correcte (JSON pur)', () => {
  const result = parseRevisionResponse(JSON.stringify(validPayload));
  assert.equal(result.valid, true);
  assert.equal(result.data.revisedTranslation, 'Bonjour le monde.');
  assert.deepEqual(result.data.warnings, []);
});

test('avertissements vides acceptés', () => {
  const result = parseRevisionResponse(JSON.stringify({ ...validPayload, warnings: [] }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.data.warnings, []);
});

test('avertissements présents transmis tels quels', () => {
  const withWarnings = { ...validPayload, warnings: ['Le terme "cloud" reste ambigu sans contexte technique.'] };
  const result = parseRevisionResponse(JSON.stringify(withWarnings));
  assert.equal(result.valid, true);
  assert.equal(result.data.warnings.length, 1);
});

test('JSON entouré de texte (préambule + explication du modèle)', () => {
  const raw = `Voici la révision demandée :\n${JSON.stringify(validPayload)}\nJ'espère que ça aide !`;
  const result = parseRevisionResponse(raw);
  assert.equal(result.valid, true);
  assert.equal(result.data.revisedTranslation, 'Bonjour le monde.');
});

test('JSON incomplet — revisedTranslation manquant', () => {
  const { revisedTranslation, ...rest } = validPayload;
  const result = parseRevisionResponse(JSON.stringify(rest));
  assert.equal(result.valid, false);
});

test('JSON incomplet — checks manquant', () => {
  const { checks, ...rest } = validPayload;
  const result = parseRevisionResponse(JSON.stringify(rest));
  assert.equal(result.valid, false);
});

test('JSON incomplet — une valeur de checks non booléenne', () => {
  const bad = { ...validPayload, checks: { ...validPayload.checks, tonePreserved: 'oui' } };
  const result = parseRevisionResponse(JSON.stringify(bad));
  assert.equal(result.valid, false);
});

test('réponse Groq invalide — pas de JSON du tout', () => {
  const result = parseRevisionResponse('Désolé, je ne peux pas faire ça.');
  assert.equal(result.valid, false);
});

test('réponse vide rejetée proprement', () => {
  assert.equal(parseRevisionResponse('').valid, false);
  assert.equal(parseRevisionResponse(null).valid, false);
  assert.equal(parseRevisionResponse(undefined).valid, false);
});

test('changesMade/warnings absents sont normalisés en tableaux vides', () => {
  const { changesMade, warnings, ...rest } = validPayload;
  const result = parseRevisionResponse(JSON.stringify(rest));
  assert.equal(result.valid, true);
  assert.deepEqual(result.data.changesMade, []);
  assert.deepEqual(result.data.warnings, []);
});

test('jamais de JSON brut renvoyé — data.revisedTranslation est du texte, pas un objet', () => {
  const result = parseRevisionResponse(JSON.stringify(validPayload));
  assert.equal(typeof result.data.revisedTranslation, 'string');
  assert.doesNotMatch(result.data.revisedTranslation, /^\s*\{/);
});
