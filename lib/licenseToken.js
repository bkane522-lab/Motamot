// Jetons premium signés côté serveur (HMAC-SHA256), pour remplacer le simple
// booléen localStorage qu'importe qui pouvait falsifier depuis la console du
// navigateur. Sans le secret serveur, il est impossible de forger un jeton
// valide — c'est ce qui rend le contrôle "réellement" côté serveur.

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input) {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Émet un jeton signé au format payloadBase64.signatureBase64.
 * @param {object} payload - doit contenir au moins `exp` (timestamp ms).
 * @param {string} secret - secret serveur (ne jamais exposer au client).
 */
function signToken(payload, secret) {
  if (!secret) throw new Error('secret manquant pour signer le jeton');
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64url(payloadStr);
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

/**
 * Vérifie un jeton émis par signToken. Retourne { valid, payload, reason }.
 */
function verifyToken(token, secret) {
  if (!secret) return { valid: false, reason: 'secret manquant côté serveur' };
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'format de jeton invalide' };
  }
  const [payloadB64, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');

  const sigBuf = Buffer.from(signature || '', 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'signature invalide' };
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64));
  } catch {
    return { valid: false, reason: 'payload illisible' };
  }

  if (typeof payload.exp === 'number' && Date.now() > payload.exp) {
    return { valid: false, reason: 'jeton expiré' };
  }

  return { valid: true, payload };
}

module.exports = { signToken, verifyToken };
