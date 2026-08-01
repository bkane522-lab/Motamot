const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerifyLicenseHandler } = require('../lib/verifyLicenseHandler');
const { verifyToken } = require('../lib/licenseToken');
const { mockReq, mockRes } = require('./_mockReqRes');

function gumroadFetch({ success = true, onRequest } = {}) {
  return async (url, options = {}) => {
    if (onRequest) onRequest(url, options);
    if (url.includes('gumroad.com')) {
      return { ok: true, json: async () => ({ success }) };
    }
    return { ok: true, json: async () => ({ result: 1 }) };
  };
}

const baseEnv = { GUMROAD_PRODUCT_ID: 'prod_123', LICENSE_SECRET: 'sup3r-secret' };

test('400 si la clé de licence est manquante', async () => {
  const handler = createVerifyLicenseHandler({ fetchImpl: gumroadFetch(), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: {} }), res);
  assert.equal(res.statusCode, 400);
});

test('500 si le produit Gumroad n\'est pas configuré', async () => {
  const handler = createVerifyLicenseHandler({ fetchImpl: gumroadFetch(), env: { LICENSE_SECRET: 'x' } });
  const res = mockRes();
  await handler(mockReq({ body: { licenseKey: 'ABC' } }), res);
  assert.equal(res.statusCode, 500);
});

test('500 si LICENSE_SECRET n\'est pas configuré', async () => {
  const handler = createVerifyLicenseHandler({
    fetchImpl: gumroadFetch(),
    env: { GUMROAD_PRODUCT_ID: 'prod_123' },
  });
  const res = mockRes();
  await handler(mockReq({ body: { licenseKey: 'ABC' } }), res);
  assert.equal(res.statusCode, 500);
});

test('400 valid:false si Gumroad refuse la clé', async () => {
  const handler = createVerifyLicenseHandler({ fetchImpl: gumroadFetch({ success: false }), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: { licenseKey: 'FAUSSE-CLE' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.valid, false);
});

test('200 avec un jeton signé et vérifiable si Gumroad valide la clé', async () => {
  const handler = createVerifyLicenseHandler({ fetchImpl: gumroadFetch({ success: true }), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: { licenseKey: 'VRAIE-CLE' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.valid, true);
  assert.ok(res.body.token);

  const verification = verifyToken(res.body.token, baseEnv.LICENSE_SECRET);
  assert.equal(verification.valid, true);
  assert.equal(verification.payload.scope, 'premium');
});

test('le jeton émis est inutilisable avec un mauvais secret (pas de contournement)', async () => {
  const handler = createVerifyLicenseHandler({ fetchImpl: gumroadFetch({ success: true }), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: { licenseKey: 'VRAIE-CLE' } }), res);
  const verification = verifyToken(res.body.token, 'mauvais-secret');
  assert.equal(verification.valid, false);
});


test('envoie product_id et jamais product_permalink à Gumroad', async () => {
  let body = '';
  const handler = createVerifyLicenseHandler({
    fetchImpl: gumroadFetch({ onRequest: (_url, options) => { body = options.body || ''; } }),
    env: baseEnv,
  });
  const res = mockRes();
  await handler(mockReq({ body: { licenseKey: 'VRAIE-CLE', productPermalink: 'ne-doit-pas-etre-utilise' } }), res);
  const params = new URLSearchParams(body);
  assert.equal(params.get('product_id'), baseEnv.GUMROAD_PRODUCT_ID);
  assert.equal(params.get('product_permalink'), null);
  assert.equal(params.get('license_key'), 'VRAIE-CLE');
});
