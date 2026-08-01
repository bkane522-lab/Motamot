const test = require('node:test');
const assert = require('node:assert/strict');
const { getClientIp } = require('../lib/getClientIp');

test('utilise x-forwarded-for si présent', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: {} };
  assert.equal(getClientIp(req), '1.2.3.4');
});

test('retombe sur remoteAddress si pas de x-forwarded-for', () => {
  const req = { headers: {}, socket: { remoteAddress: '9.9.9.9' } };
  assert.equal(getClientIp(req), '9.9.9.9');
});

test('retombe sur "unknown" en dernier recours', () => {
  const req = { headers: {}, socket: {} };
  assert.equal(getClientIp(req), 'unknown');
});
