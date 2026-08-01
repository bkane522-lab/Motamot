const test = require('node:test');
const assert = require('node:assert/strict');
const { createReviseHandler } = require('../lib/reviseHandler');
const { signToken } = require('../lib/licenseToken');
const { mockReq, mockRes } = require('./_mockReqRes');

const SECRET = 'sup3r-secret';
const baseEnv = { LICENSE_SECRET: SECRET, GROQ_API_KEY: 'x' };

const validPayload = {
  revisedTranslation: 'Hello, corrected world.',
  changesMade: ['Fixed a mistranslation of "monde"'],
  warnings: [],
  checks: { meaningPreserved: true, tonePreserved: true, namesAndNumbersPreserved: true, naturalLanguage: true },
};

function premiumAuthHeader() {
  const token = signToken({ exp: Date.now() + 100000, scope: 'premium' }, SECRET);
  return { authorization: `Bearer ${token}` };
}

function groqFetch({ content = JSON.stringify(validPayload), fail = false, throwNetworkError = false } = {}) {
  let calls = 0;
  let lastBody = null;
  const impl = async (url, options) => {
    calls++;
    if (throwNetworkError) throw new Error('network down (timeout simulé)');
    if (url.includes('groq.com')) {
      lastBody = options?.body ? JSON.parse(options.body) : null;
      if (fail) return { ok: false, status: 500, text: async () => 'boom' };
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
    }
    return { ok: true, json: async () => ({ result: 1 }) };
  };
  impl.getCallCount = () => calls;
  impl.getLastBody = () => lastBody;
  return impl;
}

const baseBody = { originalText: 'Bonjour le monde', translation: 'Hello world', targetLang: 'anglais' };

test('accès sans jeton premium -> 401, aucun appel Groq', async () => {
  const fetchImpl = groqFetch();
  const handler = createReviseHandler({ fetchImpl, env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(fetchImpl.getCallCount(), 0);
});

test('jeton expiré -> 401', async () => {
  const expired = signToken({ exp: Date.now() - 1000, scope: 'premium' }, SECRET);
  const fetchImpl = groqFetch();
  const handler = createReviseHandler({ fetchImpl, env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: { authorization: `Bearer ${expired}` } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(fetchImpl.getCallCount(), 0);
});

test('jeton trafiqué (signature modifiée) -> 401', async () => {
  const token = signToken({ exp: Date.now() + 100000, scope: 'premium' }, SECRET);
  const tampered = token.slice(0, -2) + 'zz';
  const fetchImpl = groqFetch();
  const handler = createReviseHandler({ fetchImpl, env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: { authorization: `Bearer ${tampered}` } }), res);
  assert.equal(res.statusCode, 401);
});

test('jeton signé avec un mauvais secret -> 401', async () => {
  const wrongSecretToken = signToken({ exp: Date.now() + 100000, scope: 'premium' }, 'autre-secret');
  const fetchImpl = groqFetch();
  const handler = createReviseHandler({ fetchImpl, env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: { authorization: `Bearer ${wrongSecretToken}` } }), res);
  assert.equal(res.statusCode, 401);
});

test('méthode HTTP incorrecte (GET) -> 405', async () => {
  const handler = createReviseHandler({ fetchImpl: groqFetch(), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ method: 'GET', body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 405);
});

test('texte original absent -> 400', async () => {
  const handler = createReviseHandler({ fetchImpl: groqFetch(), env: baseEnv });
  const res = mockRes();
  await handler(
    mockReq({ body: { translation: 'hello', targetLang: 'anglais' }, headers: premiumAuthHeader() }),
    res
  );
  assert.equal(res.statusCode, 400);
});

test('traduction absente -> 400', async () => {
  const handler = createReviseHandler({ fetchImpl: groqFetch(), env: baseEnv });
  const res = mockRes();
  await handler(
    mockReq({ body: { originalText: 'bonjour', targetLang: 'anglais' }, headers: premiumAuthHeader() }),
    res
  );
  assert.equal(res.statusCode, 400);
});

test('longueur excessive -> 400', async () => {
  const handler = createReviseHandler({ fetchImpl: groqFetch(), env: baseEnv });
  const res = mockRes();
  await handler(
    mockReq({
      body: { originalText: 'a'.repeat(8001), translation: 'hello', targetLang: 'anglais' },
      headers: premiumAuthHeader(),
    }),
    res
  );
  assert.equal(res.statusCode, 400);
});

test('réponse Groq invalide (pas de JSON) -> 502, jamais de JSON brut renvoyé', async () => {
  const handler = createReviseHandler({
    fetchImpl: groqFetch({ content: "Désolé, je ne peux pas faire ça." }),
    env: baseEnv,
  });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(typeof res.body.error, 'string');
  assert.equal(res.body.revisedTranslation, undefined);
});

test('JSON incomplet (checks manquant) -> 502', async () => {
  const { checks, ...incomplete } = validPayload;
  const handler = createReviseHandler({
    fetchImpl: groqFetch({ content: JSON.stringify(incomplete) }),
    env: baseEnv,
  });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 502);
});

test('JSON entouré de texte -> extrait et accepté (200)', async () => {
  const wrapped = `Voici :\n${JSON.stringify(validPayload)}\nVoilà !`;
  const handler = createReviseHandler({ fetchImpl: groqFetch({ content: wrapped }), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.revisedTranslation, validPayload.revisedTranslation);
});

test('réponse correcte -> 200 avec le schéma complet, exactement un appel Groq', async () => {
  const fetchImpl = groqFetch();
  const handler = createReviseHandler({ fetchImpl, env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.revisedTranslation, validPayload.revisedTranslation);
  assert.deepEqual(res.body.changesMade, validPayload.changesMade);
  assert.deepEqual(res.body.warnings, []);
  assert.deepEqual(res.body.checks, validPayload.checks);
  assert.equal(fetchImpl.getCallCount(), 1);
});

test('avertissements vides transmis correctement (200)', async () => {
  const handler = createReviseHandler({ fetchImpl: groqFetch(), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.deepEqual(res.body.warnings, []);
});

test('avertissements présents transmis correctement (200)', async () => {
  const withWarnings = { ...validPayload, warnings: ['Terme technique ambigu : "cloud".'] };
  const handler = createReviseHandler({ fetchImpl: groqFetch({ content: JSON.stringify(withWarnings) }), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.warnings.length, 1);
});

test('rate limiting dédié -> 429', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/incr/')) return { ok: true, json: async () => ({ result: 999 }) };
    if (url.includes('/expire/')) return { ok: true, json: async () => ({ result: 1 }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(validPayload) } }] }) };
  };
  const handler = createReviseHandler({
    fetchImpl,
    env: { ...baseEnv, UPSTASH_REDIS_REST_URL: 'https://fake', UPSTASH_REDIS_REST_TOKEN: 't' },
  });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 429);
});

test('rate limit configurable via REVISE_RATE_LIMIT', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/incr/')) return { ok: true, json: async () => ({ result: 3 }) };
    if (url.includes('/expire/')) return { ok: true, json: async () => ({ result: 1 }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(validPayload) } }] }) };
  };
  // limite abaissée à 2 -> une 3e requête dans la fenêtre doit être bloquée
  const handler = createReviseHandler({
    fetchImpl,
    env: { ...baseEnv, UPSTASH_REDIS_REST_URL: 'https://fake', UPSTASH_REDIS_REST_TOKEN: 't', REVISE_RATE_LIMIT: '2' },
  });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 429);
});

test('erreur Groq (500 amont) -> 500, message générique sans détail interne', async () => {
  const handler = createReviseHandler({ fetchImpl: groqFetch({ fail: true }), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(res.body.error, /boom/);
});

test('timeout simulé (fetch qui rejette) -> 500 géré proprement, pas de crash', async () => {
  const handler = createReviseHandler({ fetchImpl: groqFetch({ throwNetworkError: true }), env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 500);
});

test('absence de clé Groq -> 500, aucun appel réseau', async () => {
  const fetchImpl = groqFetch();
  const handler = createReviseHandler({ fetchImpl, env: { LICENSE_SECRET: SECRET } });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(fetchImpl.getCallCount(), 0);
});

test('CORS : origine autorisée reflétée, origine non listée ignorée', async () => {
  const handler = createReviseHandler({
    fetchImpl: groqFetch(),
    env: { ...baseEnv, ALLOWED_ORIGINS: 'https://motamot.vercel.app' },
  });

  const resAllowed = mockRes();
  await handler(
    mockReq({ body: baseBody, headers: { ...premiumAuthHeader(), origin: 'https://motamot.vercel.app' } }),
    resAllowed
  );
  assert.equal(resAllowed.headers['Access-Control-Allow-Origin'], 'https://motamot.vercel.app');

  const resBlocked = mockRes();
  await handler(
    mockReq({ body: baseBody, headers: { ...premiumAuthHeader(), origin: 'https://evil.example' } }),
    resBlocked
  );
  assert.equal(resBlocked.headers['Access-Control-Allow-Origin'], undefined);
});

test('le prompt envoyé à Groq demande explicitement la préservation des noms et des chiffres', async () => {
  const fetchImpl = groqFetch();
  const handler = createReviseHandler({ fetchImpl, env: baseEnv });
  const res = mockRes();
  await handler(mockReq({ body: baseBody, headers: premiumAuthHeader() }), res);

  const sentBody = fetchImpl.getLastBody();
  const systemMsg = sentBody.messages.find((m) => m.role === 'system').content;
  assert.match(systemMsg, /noms propres/i);
  assert.match(systemMsg, /chiffres/i);
  assert.match(systemMsg, /dates/i);
  assert.match(systemMsg, /montants/i);

  const userMsg = sentBody.messages.find((m) => m.role === 'user').content;
  assert.match(userMsg, /Bonjour le monde/); // le texte original est bien transmis tel quel
  assert.match(userMsg, /Hello world/); // la traduction à réviser aussi
});
