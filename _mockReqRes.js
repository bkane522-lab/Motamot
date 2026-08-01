// Petits mocks req/res compatibles avec l'API Vercel (res.status().json()/.end()),
// utilisés par tous les tests de handlers.

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

function mockReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return { method, body, headers, socket: { remoteAddress: '127.0.0.1' } };
}

module.exports = { mockRes, mockReq };
