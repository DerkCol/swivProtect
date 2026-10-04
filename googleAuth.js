// Verifies a Google-issued OpenID Connect ID token (a signed RS256 JWT) with no third-party library.
// Used so the Gmail add-on can prove which Gmail address is calling, without the user pasting a key.
//
// A token is accepted only if ALL of these hold:
//   - it is signed with RS256 by one of Google's published keys (fetched from the JWKS URL and cached);
//   - the issuer is Google, it has not expired, and it was not issued in the future;
//   - its audience (aud) is one of the client IDs this server was configured to trust (GOOGLE_AUDIENCE);
//   - it carries an email address that Google marks as verified.
// Anything else, including "alg: none" and HMAC tokens signed with the public key, is rejected.

import crypto from 'node:crypto';

const DEFAULT_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const MIN_REFETCH_MS = 60_000;      // never refetch Google's keys more often than this because of unknown key ids
const CLOCK_SKEW_MS = 30_000;

export class GoogleAuthError extends Error {          // the token is not acceptable
  constructor(message, detail = {}) { super(message); this.detail = detail; }
}
export class GoogleUnavailableError extends Error {}   // we could not reach Google to get its keys

const decodeJson = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const B64URL = /^[A-Za-z0-9_-]+$/;

export function createGoogleVerifier({ audiences = [], jwksUrl = DEFAULT_JWKS_URL, fetchImpl = fetch, now = Date.now } = {}) {
  if (!/^https:\/\//i.test(jwksUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(jwksUrl)) {
    throw new Error('The Google key address must be https (plain http is only allowed for localhost, in tests).');
  }
  const wanted = audiences.filter(Boolean);
  let keys = new Map();        // kid -> KeyObject
  let fetchedAt = 0;
  let ttlMs = 0;
  let loading = null;

  async function loadKeys() {
    if (loading) return loading;
    loading = (async () => {
      let res;
      try { res = await fetchImpl(jwksUrl, { signal: AbortSignal.timeout(5000) }); }
      catch (e) { throw new GoogleUnavailableError(`could not fetch Google's keys: ${e.message}`); }
      if (!res.ok) throw new GoogleUnavailableError(`Google's key server answered ${res.status}`);
      let body;
      try { body = await res.json(); } catch { throw new GoogleUnavailableError('Google sent unreadable keys'); }
      const next = new Map();
      for (const jwk of body.keys || []) {
        if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || (jwk.use && jwk.use !== 'sig')) continue;
        try { next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })); } catch { /* skip a bad key */ }
      }
      if (!next.size) throw new GoogleUnavailableError('Google sent no usable keys');
      const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
      keys = next;
      fetchedAt = now();
      ttlMs = Math.min(Math.max((maxAge ? Number(maxAge[1]) : 3600) * 1000, 60_000), 24 * 3600_000);
    })().finally(() => { loading = null; });
    return loading;
  }

  async function keyFor(kid) {
    const age = now() - fetchedAt;
    if (!keys.size || age >= ttlMs) await loadKeys();                    // first use, or the cache is stale
    else if (!keys.has(kid) && age >= MIN_REFETCH_MS) await loadKeys();  // Google may have rotated keys; try once per minute at most
    return keys.get(kid) || null;
  }

  async function verify(token) {
    if (!wanted.length) throw new GoogleAuthError('Google sign-in is not configured');
    const parts = String(token).split('.');
    if (parts.length !== 3 || !parts.every(p => p && B64URL.test(p))) throw new GoogleAuthError('malformed token');

    let header, payload;
    try { header = decodeJson(parts[0]); payload = decodeJson(parts[1]); }
    catch { throw new GoogleAuthError('unreadable token'); }

    if (header.alg !== 'RS256') throw new GoogleAuthError('unsupported algorithm', { alg: header.alg });   // blocks alg:none and HS256 tricks
    if (typeof header.kid !== 'string') throw new GoogleAuthError('missing key id');

    const key = await keyFor(header.kid);
    if (!key) throw new GoogleAuthError('unknown signing key');
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) throw new GoogleAuthError('bad signature');

    if (!ISSUERS.has(payload.iss)) throw new GoogleAuthError('wrong issuer', { iss: payload.iss });
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const aud = auds.find(a => wanted.includes(a));
    if (!aud) throw new GoogleAuthError('audience mismatch', { aud: payload.aud });
    const t = now();
    if (typeof payload.exp !== 'number' || payload.exp * 1000 + CLOCK_SKEW_MS < t) throw new GoogleAuthError('token expired');
    if (typeof payload.iat === 'number' && payload.iat * 1000 - 5 * 60_000 > t) throw new GoogleAuthError('token issued in the future');
    if (typeof payload.email !== 'string' || !payload.email) throw new GoogleAuthError('no email in token (the add-on needs the userinfo.email scope)');
    if (payload.email_verified !== true && payload.email_verified !== 'true') throw new GoogleAuthError('email not verified by Google');

    return { email: payload.email.trim().toLowerCase(), sub: String(payload.sub || ''), aud };
  }

  return { enabled: wanted.length > 0, verify };
}
