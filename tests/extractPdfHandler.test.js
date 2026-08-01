const test = require('node:test');
const assert = require('node:assert/strict');
const { createExtractPdfHandler } = require('../lib/extractPdfHandler');
const { signToken } = require('../lib/licenseToken');
const { mockReq, mockRes } = require('./_mockReqRes');

const SECRET = 'sup3r-secret';
const env = { LICENSE_SECRET: SECRET };

function validAuthHeader() {
  const token = signToken({ exp: Date.now() + 100000, scope: 'premium' }, SECRET);
  return { authorization: `Bearer ${token}` };
}

const fakePdfBuffer = Buffer.from('%PDF-1.4 fake content').toString('base64');

test('401 sans jeton', async () => {
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  await handler(mockReq({ body: { fileBase64: fakePdfBuffer }, headers: {} }), res);
  assert.equal(res.statusCode, 401);
});

test('401 avec un jeton invalide', async () => {
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  await handler(
    mockReq({ body: { fileBase64: fakePdfBuffer }, headers: { authorization: 'Bearer faux-jeton' } }),
    res
  );
  assert.equal(res.statusCode, 401);
});

test('401 avec un jeton expiré', async () => {
  const expiredToken = signToken({ exp: Date.now() - 1000 }, SECRET);
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  await handler(
    mockReq({ body: { fileBase64: fakePdfBuffer }, headers: { authorization: `Bearer ${expiredToken}` } }),
    res
  );
  assert.equal(res.statusCode, 401);
});

test('400 si le fichier est manquant', async () => {
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  await handler(mockReq({ body: {}, headers: validAuthHeader() }), res);
  assert.equal(res.statusCode, 400);
});

test('400 si le fichier dépasse 4 Mo', async () => {
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  const bigBuffer = Buffer.alloc(4 * 1024 * 1024 + 10).toString('base64');
  await handler(mockReq({ body: { fileBase64: bigBuffer }, headers: validAuthHeader() }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /volumineux/i);
});

test('422 si le PDF est corrompu (le parseur échoue)', async () => {
  const handler = createExtractPdfHandler({
    pdfParseImpl: async () => { throw new Error('bad pdf'); },
    env,
  });
  const res = mockRes();
  await handler(mockReq({ body: { fileBase64: fakePdfBuffer }, headers: validAuthHeader() }), res);
  assert.equal(res.statusCode, 422);
});

test('422 si aucun texte n\'est trouvé (PDF scanné)', async () => {
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: '   ' }), env });
  const res = mockRes();
  await handler(mockReq({ body: { fileBase64: fakePdfBuffer }, headers: validAuthHeader() }), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /scan/i);
});

test('401 avec un jeton valide mais de mauvais scope', async () => {
  const wrongScopeToken = signToken({ exp: Date.now() + 100000, scope: 'autre-chose' }, SECRET);
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  await handler(
    mockReq({ body: { fileBase64: fakePdfBuffer }, headers: { authorization: `Bearer ${wrongScopeToken}` } }),
    res
  );
  assert.equal(res.statusCode, 401);
});

test('200 avec le texte extrait pour un jeton valide et un PDF correct', async () => {
  const handler = createExtractPdfHandler({
    pdfParseImpl: async () => ({ text: 'Contenu extrait du PDF', numpages: 3 }),
    env,
  });
  const res = mockRes();
  await handler(mockReq({ body: { fileBase64: fakePdfBuffer }, headers: validAuthHeader() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'Contenu extrait du PDF');
  assert.equal(res.body.pages, 3);
});

test('sans jeton signé avec le bon secret, impossible de forger un accès (test anti-contournement)', async () => {
  // Simule exactement ce qu'un utilisateur ferait dans la console du navigateur :
  // écrire un faux jeton "qui a l'air valide" sans connaître le secret serveur.
  const handler = createExtractPdfHandler({ pdfParseImpl: async () => ({ text: 'x' }), env });
  const res = mockRes();
  const fakeToken = Buffer.from(JSON.stringify({ exp: Date.now() + 999999, scope: 'premium' })).toString('base64') + '.0000';
  await handler(
    mockReq({ body: { fileBase64: fakePdfBuffer }, headers: { authorization: `Bearer ${fakeToken}` } }),
    res
  );
  assert.equal(res.statusCode, 401);
});
