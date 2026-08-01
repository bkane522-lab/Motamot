const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCors } = require('../lib/cors');
const { mockReq, mockRes } = require('./_mockReqRes');

test('sans liste configurée, ne pose pas de Access-Control-Allow-Origin (pas de joker)', () => {
  const req = mockReq({ headers: { origin: 'https://evil.example' } });
  const res = mockRes();
  applyCors(req, res, '');
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});

test('avec une liste configurée, autorise une origine listée', () => {
  const req = mockReq({ headers: { origin: 'https://motamot.vercel.app' } });
  const res = mockRes();
  applyCors(req, res, 'https://motamot.vercel.app,https://autre.example');
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://motamot.vercel.app');
});

test('avec une liste configurée, refuse une origine non listée', () => {
  const req = mockReq({ headers: { origin: 'https://evil.example' } });
  const res = mockRes();
  applyCors(req, res, 'https://motamot.vercel.app');
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});
