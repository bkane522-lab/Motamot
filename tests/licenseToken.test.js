const test = require('node:test');
const assert = require('node:assert/strict');
const { signToken, verifyToken } = require('../lib/licenseToken');

test('un jeton valide se vérifie avec le bon secret', () => {
  const token = signToken({ exp: Date.now() + 10000, scope: 'premium' }, 'secret-123');
  const result = verifyToken(token, 'secret-123');
  assert.equal(result.valid, true);
  assert.equal(result.payload.scope, 'premium');
});

test('un jeton signé avec un autre secret est rejeté', () => {
  const token = signToken({ exp: Date.now() + 10000 }, 'secret-A');
  const result = verifyToken(token, 'secret-B');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature invalide');
});

test('un jeton expiré est rejeté', () => {
  const token = signToken({ exp: Date.now() - 1000 }, 'secret-123');
  const result = verifyToken(token, 'secret-123');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'jeton expiré');
});

test('un jeton trafiqué (payload modifié) est rejeté', () => {
  const token = signToken({ exp: Date.now() + 10000, scope: 'premium' }, 'secret-123');
  const [payloadB64, signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 999999999, scope: 'admin' }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = `${forgedPayload}.${signature}`;
  const result = verifyToken(forged, 'secret-123');
  assert.equal(result.valid, false);
});

test('un format de jeton invalide est rejeté proprement', () => {
  assert.equal(verifyToken('', 'secret').valid, false);
  assert.equal(verifyToken(null, 'secret').valid, false);
  assert.equal(verifyToken('pasdepoint', 'secret').valid, false);
});

test('signToken exige un secret', () => {
  assert.throws(() => signToken({ exp: 1 }, ''));
});
