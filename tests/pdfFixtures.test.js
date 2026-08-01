// Tests avec de VRAIS fichiers PDF (pas des mocks) — voir tests/fixtures/.
// Deux niveaux de vérification :
//  1. Toujours exécuté ici : signature %PDF-, taille, câblage complet du
//     handler avec les vrais octets des fixtures (parseur injecté simulé,
//     puisque `unpdf` ne peut pas être installé dans cet environnement sans
//     accès réseau).
//  2. Exécuté UNIQUEMENT si `unpdf` est réellement installé (ce qui n'est
//     pas le cas ici — voir README) : extraction réelle du texte de chaque
//     PDF de test, comparée au contenu qu'on sait y avoir mis. Si le module
//     est absent, ces sous-tests sont marqués `skip` avec un message
//     explicite plutôt que silencieusement ignorés ou faussement validés.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createExtractPdfHandler, hasPdfSignature } = require('../lib/extractPdfHandler');
const { signToken } = require('../lib/licenseToken');
const { mockReq, mockRes } = require('./_mockReqRes');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SECRET = 'sup3r-secret';
const env = { LICENSE_SECRET: SECRET };

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

function authHeader() {
  const token = signToken({ exp: Date.now() + 100000, scope: 'premium' }, SECRET);
  return { authorization: `Bearer ${token}` };
}

const FIXTURES = ['simple-text.pdf', 'multi-paragraph.pdf', 'accents-francais.pdf', 'scanned-no-text.pdf', 'corrupted.pdf'];

test('les fixtures existent bien et sont de vrais fichiers PDF non vides', () => {
  for (const name of FIXTURES) {
    const buffer = loadFixture(name);
    assert.ok(buffer.length > 0, `${name} ne doit pas être vide`);
  }
});

test('hasPdfSignature reconnaît toutes les fixtures comme des PDF valides (même le "corrompu" — l\'en-tête, lui, est intact)', () => {
  for (const name of FIXTURES) {
    const buffer = loadFixture(name);
    assert.equal(hasPdfSignature(buffer), true, `${name} doit avoir une signature %PDF- valide`);
  }
});

test('le handler complet accepte les vrais octets d\'un vrai PDF texte (avec un parseur simulé)', async () => {
  const buffer = loadFixture('simple-text.pdf');
  const handler = createExtractPdfHandler({
    pdfParseImpl: async () => ({ text: 'texte simulé', numpages: 1 }),
    env,
  });
  const res = mockRes();
  await handler(
    mockReq({ body: { fileBase64: buffer.toString('base64') }, headers: authHeader() }),
    res
  );
  assert.equal(res.statusCode, 200);
});

test('le handler complet rejette un token absent même avec un vrai PDF valide en pièce jointe', async () => {
  const buffer = loadFixture('simple-text.pdf');
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  await handler(mockReq({ body: { fileBase64: buffer.toString('base64') }, headers: {} }), res);
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------
// Extraction RÉELLE avec unpdf — exécutée seulement si le module est
// disponible. Dans cet environnement de développement (sans accès réseau),
// il ne l'est pas : ces tests seront marqués "skip", pas "pass" — voir le
// compte rendu, il ne faut jamais confondre les deux.
// ---------------------------------------------------------------------

async function tryLoadUnpdf() {
  try {
    return await import('unpdf');
  } catch {
    return null;
  }
}

test('extraction RÉELLE (unpdf) — texte simple', async (t) => {
  const unpdf = await tryLoadUnpdf();
  if (!unpdf) {
    t.skip('unpdf non installé dans cet environnement (pas d\'accès réseau) — à exécuter après npm install en conditions réelles');
    return;
  }
  const buffer = loadFixture('simple-text.pdf');
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
  const { text } = await unpdf.extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n') : text;
  assert.match(merged, /Motamot/);
});

test('extraction RÉELLE (unpdf) — multi-paragraphes', async (t) => {
  const unpdf = await tryLoadUnpdf();
  if (!unpdf) {
    t.skip('unpdf non installé dans cet environnement (pas d\'accès réseau)');
    return;
  }
  const buffer = loadFixture('multi-paragraph.pdf');
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
  const { text } = await unpdf.extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n') : text;
  assert.match(merged, /Premier paragraphe/);
  assert.match(merged, /Troisieme/);
});

test('extraction RÉELLE (unpdf) — accents français préservés', async (t) => {
  const unpdf = await tryLoadUnpdf();
  if (!unpdf) {
    t.skip('unpdf non installé dans cet environnement (pas d\'accès réseau)');
    return;
  }
  const buffer = loadFixture('accents-francais.pdf');
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
  const { text } = await unpdf.extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n') : text;
  assert.match(merged, /révision/);
  assert.match(merged, /éléphant/);
});

test('extraction RÉELLE (unpdf) — PDF scanné : ouverture OK, texte vide (pas une erreur)', async (t) => {
  const unpdf = await tryLoadUnpdf();
  if (!unpdf) {
    t.skip('unpdf non installé dans cet environnement (pas d\'accès réseau)');
    return;
  }
  const buffer = loadFixture('scanned-no-text.pdf');
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
  const { text } = await unpdf.extractText(pdf, { mergePages: true });
  const merged = (Array.isArray(text) ? text.join('') : text).trim();
  assert.equal(merged, '', 'un PDF scanné doit produire un texte vide, pas une exception');
});

test('extraction RÉELLE (unpdf) — PDF corrompu : lève une erreur (pas un plantage silencieux)', async (t) => {
  const unpdf = await tryLoadUnpdf();
  if (!unpdf) {
    t.skip('unpdf non installé dans cet environnement (pas d\'accès réseau)');
    return;
  }
  const buffer = loadFixture('corrupted.pdf');
  await assert.rejects(() => unpdf.getDocumentProxy(new Uint8Array(buffer)));
});
