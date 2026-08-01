const test = require('node:test');
const assert = require('node:assert/strict');
const { checkRateLimit } = require('../lib/rateLimit');

function fakeFetch(sequenceOfCounts) {
  let call = 0;
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.includes('/incr/')) {
      const count = sequenceOfCounts[call++] ?? sequenceOfCounts[sequenceOfCounts.length - 1];
      return { ok: true, json: async () => ({ result: count }) };
    }
    if (url.includes('/expire/')) {
      return { ok: true, json: async () => ({ result: 1 }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

test('sans Upstash configuré, ferme par défaut (fail-closed)', async () => {
  const result = await checkRateLimit({ key: 'k', limit: 5, windowSeconds: 60, fetchImpl: fakeFetch([1]) });
  assert.equal(result.allowed, false);
  assert.equal(result.configured, false);
});

test('sans Upstash configuré, peut ouvrir explicitement (failOpenIfUnconfigured)', async () => {
  const result = await checkRateLimit({
    key: 'k', limit: 5, windowSeconds: 60, failOpenIfUnconfigured: true, fetchImpl: fakeFetch([1]),
  });
  assert.equal(result.allowed, true);
});

test('autorise sous la limite', async () => {
  const result = await checkRateLimit({
    redisUrl: 'https://fake', redisToken: 't', key: 'k', limit: 5, windowSeconds: 60, fetchImpl: fakeFetch([3]),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 2);
});

test('bloque au-delà de la limite', async () => {
  const result = await checkRateLimit({
    redisUrl: 'https://fake', redisToken: 't', key: 'k', limit: 5, windowSeconds: 60, fetchImpl: fakeFetch([6]),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
});

test('pose une expiration seulement au premier appel de la fenêtre', async () => {
  const fetchImpl = fakeFetch([1]);
  await checkRateLimit({ redisUrl: 'https://fake', redisToken: 't', key: 'k', limit: 5, windowSeconds: 60, fetchImpl });
  const expireCalls = fetchImpl.calls.filter((u) => u.includes('/expire/'));
  assert.equal(expireCalls.length, 1);
});

test('propage une erreur si Upstash répond en erreur', async () => {
  const failingFetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(() =>
    checkRateLimit({ redisUrl: 'https://fake', redisToken: 't', key: 'k', limit: 5, windowSeconds: 60, fetchImpl: failingFetch })
  );
});
