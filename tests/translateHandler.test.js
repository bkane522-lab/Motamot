const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslateHandler } = require('../lib/translateHandler');
const { mockReq, mockRes } = require('./_mockReqRes');

function groqFetch({ reply = 'Hello world', fail = false, status = 500 } = {}) {
  return async (url) => {
    if (url.includes('groq.com')) {
      if (fail) return { ok: false, status, text: async () => 'boom' };
      return { ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) };
    }
    // pas d'Upstash configuré dans ces tests -> jamais appelé, mais au cas où :
    return { ok: true, json: async () => ({ result: 1 }) };
  };
}

test('400 si le texte est manquant', async () => {
  const handler = createTranslateHandler({ fetchImpl: groqFetch(), env: { GROQ_API_KEY: 'x' } });
  const res = mockRes();
  await handler(mockReq({ body: { targetLang: 'anglais' } }), res);
  assert.equal(res.statusCode, 400);
});

test('400 si la langue cible est manquante', async () => {
  const handler = createTranslateHandler({ fetchImpl: groqFetch(), env: { GROQ_API_KEY: 'x' } });
  const res = mockRes();
  await handler(mockReq({ body: { text: 'bonjour' } }), res);
  assert.equal(res.statusCode, 400);
});

test('400 si le texte dépasse la limite', async () => {
  const handler = createTranslateHandler({ fetchImpl: groqFetch(), env: { GROQ_API_KEY: 'x' } });
  const res = mockRes();
  const tooLong = 'a'.repeat(20001);
  await handler(mockReq({ body: { text: tooLong, targetLang: 'anglais' } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /trop long/i);
});

test('500 si la clé Groq est absente', async () => {
  const handler = createTranslateHandler({ fetchImpl: groqFetch(), env: {} });
  const res = mockRes();
  await handler(mockReq({ body: { text: 'bonjour', targetLang: 'anglais' } }), res);
  assert.equal(res.statusCode, 500);
});

test('200 avec traduction sur un texte court (un seul chunk)', async () => {
  const handler = createTranslateHandler({
    fetchImpl: groqFetch({ reply: 'Hello' }),
    env: { GROQ_API_KEY: 'x' },
  });
  const res = mockRes();
  await handler(mockReq({ body: { text: 'bonjour', targetLang: 'anglais' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.translation, 'Hello');
  assert.equal(res.body.chunked, false);
});

test('découpe un texte long en plusieurs appels Groq et rassemble le résultat', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: `chunk${calls}` } }] }) };
  };
  const handler = createTranslateHandler({ fetchImpl, env: { GROQ_API_KEY: 'x' } });
  const res = mockRes();
  const longText = Array.from({ length: 6 }, (_, i) => `Paragraphe ${i} `.repeat(200)).join('\n\n');
  await handler(mockReq({ body: { text: longText, targetLang: 'anglais' } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.chunked);
  assert.ok(calls > 1, 'devrait appeler Groq plusieurs fois pour un texte long');
  assert.equal(res.body.translation, Array.from({ length: calls }, (_, i) => `chunk${i + 1}`).join('\n\n'));
});

test('gère une erreur Groq proprement (pas de fuite de détail interne)', async () => {
  const handler = createTranslateHandler({
    fetchImpl: groqFetch({ fail: true, status: 500 }),
    env: { GROQ_API_KEY: 'x' },
  });
  const res = mockRes();
  await handler(mockReq({ body: { text: 'bonjour', targetLang: 'anglais' } }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Erreur du service de traduction.');
});

test('429 si le rate limit est dépassé', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/incr/')) return { ok: true, json: async () => ({ result: 999 }) };
    if (url.includes('/expire/')) return { ok: true, json: async () => ({ result: 1 }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) };
  };
  const handler = createTranslateHandler({
    fetchImpl,
    env: { GROQ_API_KEY: 'x', UPSTASH_REDIS_REST_URL: 'https://fake', UPSTASH_REDIS_REST_TOKEN: 't' },
  });
  const res = mockRes();
  await handler(mockReq({ body: { text: 'bonjour', targetLang: 'anglais' } }), res);
  assert.equal(res.statusCode, 429);
});
