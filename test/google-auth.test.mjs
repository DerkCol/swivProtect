// Tests for Gmail add-on sign-in: the token verifier on its own, then the real server end to end.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGoogleVerifier, GoogleAuthError, GoogleUnavailableError } from '../googleAuth.js';
import { AUD, newKeyPair, makeToken, startKeyServer, startServer, nowSec } from './helpers.mjs';

const rejects = (promise, Type, message) => assert.rejects(promise, e => e instanceof Type && (!message || e.message.includes(message)), message);

describe('token verifier', () => {
  const pair = newKeyPair('k1');
  const fake = (pairs, clock) => {
    const calls = { n: 0 };
    return { calls, fetchImpl: async () => { calls.n++; return { ok: true, headers: { get: () => 'public, max-age=3600' }, json: async () => ({ keys: pairs.map(p => p.jwk) }) }; }, now: () => clock.t };
  };
  const make = (pairs, clock, extra = {}) => { const f = fake(pairs, clock); return { ...f, v: createGoogleVerifier({ audiences: [AUD], fetchImpl: f.fetchImpl, now: f.now, ...extra }) }; };

  test('accepts a good token and lowercases the email', async () => {
    const { v } = make([pair], { t: Date.now() });
    const r = await v.verify(makeToken({ pair, payload: { email: 'Rosa.Garcia@Gmail.com' } }));
    assert.equal(r.email, 'rosa.garcia@gmail.com'); assert.equal(r.aud, AUD);
  });
  test('accepts the other Google issuer spelling and a list of audiences', async () => {
    const { v } = make([pair], { t: Date.now() });
    await v.verify(makeToken({ pair, payload: { iss: 'accounts.google.com', aud: ['other', AUD] } }));
  });
  test('is disabled with no audience configured', async () => {
    const v = createGoogleVerifier({ audiences: [] });
    assert.equal(v.enabled, false);
    await rejects(v.verify(makeToken({ pair })), GoogleAuthError, 'not configured');
  });
  test('rejects wrong audience, issuer, expiry, unverified email, missing email', async () => {
    const { v } = make([pair], { t: Date.now() });
    await rejects(v.verify(makeToken({ pair, payload: { aud: 'someone-elses-client' } })), GoogleAuthError, 'audience mismatch');
    await rejects(v.verify(makeToken({ pair, payload: { iss: 'https://evil.example.com' } })), GoogleAuthError, 'wrong issuer');
    await rejects(v.verify(makeToken({ pair, payload: { exp: nowSec() - 3600 } })), GoogleAuthError, 'expired');
    await rejects(v.verify(makeToken({ pair, payload: { iat: nowSec() + 3600, exp: nowSec() + 7200 } })), GoogleAuthError, 'future');
    await rejects(v.verify(makeToken({ pair, payload: { email_verified: false } })), GoogleAuthError, 'not verified');
    await rejects(v.verify(makeToken({ pair, payload: { email: undefined } })), GoogleAuthError, 'no email');
  });
  test('rejects forged and tampered tokens', async () => {
    const { v } = make([pair], { t: Date.now() });
    await rejects(v.verify(makeToken({ pair, tamper: true })), GoogleAuthError, 'bad signature');
    const other = newKeyPair('k1');                                                  // right key id, wrong private key
    await rejects(v.verify(makeToken({ pair: other })), GoogleAuthError, 'bad signature');
    const [h, p] = makeToken({ pair }).split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url');
    await rejects(v.verify(`${none}.${p}.AAAA`), GoogleAuthError, 'unsupported algorithm');            // alg: none
    await rejects(v.verify(`${none}.${p}.`), GoogleAuthError, 'malformed');                             // none with empty signature
    const hs = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'k1' })).toString('base64url');          // HMAC keyed with the public key
    const mac = crypto.createHmac('sha256', pair.publicKey.export({ type: 'spki', format: 'pem' })).update(`${hs}.${p}`).digest('base64url');
    await rejects(v.verify(`${hs}.${p}.${mac}`), GoogleAuthError, 'unsupported algorithm');
    await rejects(v.verify('not-a-token'), GoogleAuthError, 'malformed');
    await rejects(v.verify(`${h}.${p}`), GoogleAuthError, 'malformed');
  });
  test('caches Google keys, and refetches at most once a minute for an unknown key id', async () => {
    const clock = { t: Date.now() }, { v, calls } = make([pair], clock);
    const unknown = newKeyPair('k-new');
    await v.verify(makeToken({ pair })); await v.verify(makeToken({ pair }));
    assert.equal(calls.n, 1, 'second check should use the cache');
    await rejects(v.verify(makeToken({ pair: unknown })), GoogleAuthError, 'unknown signing key');
    await rejects(v.verify(makeToken({ pair: unknown })), GoogleAuthError, 'unknown signing key');
    assert.equal(calls.n, 1, 'an unknown key id inside the first minute must not trigger refetching');
    clock.t += 61_000;
    await rejects(v.verify(makeToken({ pair: unknown })), GoogleAuthError, 'unknown signing key');
    assert.equal(calls.n, 2, 'after a minute one refetch is allowed');
    await rejects(v.verify(makeToken({ pair: unknown })), GoogleAuthError, 'unknown signing key');
    assert.equal(calls.n, 2, 'but not repeatedly');
  });
  test('picks up a rotated key and refreshes when the cache is stale', async () => {
    const clock = { t: Date.now() }, rotated = newKeyPair('k2'), pairs = [pair];
    const { v, calls } = make(pairs, clock);
    await v.verify(makeToken({ pair }));
    pairs.push(rotated); clock.t += 61_000;
    const longLived = { exp: nowSec() + 86400 };                          // so the fake clock can jump an hour ahead
    await v.verify(makeToken({ pair: rotated, payload: longLived }));     // Google added a key: found after one refetch
    assert.equal(calls.n, 2);
    clock.t += 3600_000 + 1_000;
    await v.verify(makeToken({ pair: rotated, payload: longLived }));
    assert.equal(calls.n, 3, 'a stale cache is refreshed');
  });
  test('says Google is unavailable (not that the token is bad) when keys cannot be fetched', async () => {
    const v = createGoogleVerifier({ audiences: [AUD], fetchImpl: async () => { throw new Error('offline'); } });
    await rejects(v.verify(makeToken({ pair })), GoogleUnavailableError);
    const v2 = createGoogleVerifier({ audiences: [AUD], fetchImpl: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}) }) });
    await rejects(v2.verify(makeToken({ pair })), GoogleUnavailableError);
  });
});

describe('server: linking a Gmail address and checking email with a Google sign-in', () => {
  const pair = newKeyPair('k1');
  let keys, srv, off, alice, bob;
  const tok = (payload = {}, extra = {}) => makeToken({ pair, payload, ...extra });

  before(async () => {
    keys = await startKeyServer([pair]);
    srv = await startServer({ GOOGLE_AUDIENCE: AUD, GOOGLE_JWKS_URL: keys.url, LINK_CODE_TTL_SECONDS: '2' });
    off = await startServer({});                                  // a second server with Gmail sign-in switched off
    alice = await srv.signup({ language: 'Spanish', state: 'TX' });
    bob = await srv.signup();
  });
  after(async () => { srv.stop(); off.stop(); await keys.close(); });

  test('a link code looks right and an unlinked Gmail address gets "not_linked"', async () => {
    const r = await srv.call('POST', '/api/link-code', { token: alice.token });
    assert.equal(r.status, 200); assert.match(r.json.code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/); assert.equal(r.json.expiresInSeconds, 2);
    const a = await srv.call('POST', '/api/analyze', { token: tok({ email: 'alice@gmail.com' }), body: { body: 'hello' } });
    assert.equal(a.status, 404); assert.equal(a.json.code, 'not_linked');
  });
  test('link: wrong code fails, right code works once, then the Gmail address checks email in her language', async () => {
    const id = tok({ email: 'alice@gmail.com' });
    const wrong = await srv.call('POST', '/api/link-gmail', { token: id, body: { code: 'AAAA-BBBB' } });
    assert.equal(wrong.status, 400); assert.equal(wrong.json.code, 'bad_code');
    const { json: { code } } = await srv.call('POST', '/api/link-code', { token: alice.token });
    const ok = await srv.call('POST', '/api/link-gmail', { token: id, body: { code: code.toLowerCase().replace('-', ' ') } });   // forgiving about case and spacing
    assert.equal(ok.status, 200); assert.equal(ok.json.email, 'alice@gmail.com');
    const again = await srv.call('POST', '/api/link-gmail', { token: id, body: { code } });
    assert.equal(again.status, 400, 'a code works only once');
    const a = await srv.call('POST', '/api/analyze', { token: id, body: { body: 'IRS arrest warrant, pay back taxes with gift cards' } });
    assert.equal(a.status, 200); assert.equal(a.json.language, 'Spanish'); assert.equal(a.json.level, 'high'); assert.match(a.json.headline, /estafa/);
    const me = await srv.call('GET', '/api/me', { token: alice.token });
    assert.equal(me.json.gmail, 'alice@gmail.com');
  });
  test('the normal key still works exactly as before', async () => {
    const a = await srv.call('POST', '/api/analyze', { token: bob.token, body: { body: 'package could not be delivered, redelivery fee, usps' } });
    assert.equal(a.status, 200); assert.equal(a.json.level, 'high');
  });
  test('a Google sign-in can reach ONLY the email check, never the account or its long-lived key', async () => {
    const id = tok({ email: 'alice@gmail.com' });
    for (const [m, route] of [['GET', '/api/me'], ['PUT', '/api/me'], ['GET', '/api/notifications'], ['GET', '/api/my-reports'], ['POST', '/api/reports'], ['POST', '/api/link-code'], ['POST', '/api/unlink-gmail']]) {
      const r = await srv.call(m, route, { token: id, body: {} });
      assert.equal(r.status, 401, `${m} ${route} must refuse a Google token`);
      assert.equal(JSON.stringify(r.json).includes(alice.token), false);
    }
  });
  test('bad Google tokens are refused with 401', async () => {
    const bad = {
      'wrong audience': tok({ aud: 'not-ours' }), expired: tok({ exp: nowSec() - 3600 }), 'wrong issuer': tok({ iss: 'https://evil.example' }),
      'unverified email': tok({ email_verified: false }), tampered: tok({}, { tamper: true }), 'unknown key': makeToken({ pair: newKeyPair('zzz') }),
    };
    for (const [name, t] of Object.entries(bad)) {
      const r = await srv.call('POST', '/api/analyze', { token: t, body: { body: 'x' } });
      assert.equal(r.status, 401, name); assert.equal(r.json.code, 'google_rejected', name);
    }
    assert.match(srv.logs(), /audience mismatch \(token audience: not-ours/);          // the operator is told which audience to configure
  });
  test('another account cannot take over a linked Gmail address, and unlinking frees it', async () => {
    const { json: { code } } = await srv.call('POST', '/api/link-code', { token: bob.token });
    const taken = await srv.call('POST', '/api/link-gmail', { token: tok({ email: 'alice@gmail.com' }), body: { code } });
    assert.equal(taken.status, 409); assert.equal(taken.json.code, 'already_linked');
    assert.equal((await srv.call('POST', '/api/unlink-gmail', { token: alice.token })).status, 200);
    assert.equal((await srv.call('POST', '/api/analyze', { token: tok({ email: 'alice@gmail.com' }), body: { body: 'x' } })).json.code, 'not_linked');
    const { json: { code: c2 } } = await srv.call('POST', '/api/link-code', { token: bob.token });
    assert.equal((await srv.call('POST', '/api/link-gmail', { token: tok({ email: 'alice@gmail.com' }), body: { code: c2 } })).status, 200, 'now Bob can link it');
  });
  test('codes expire', async () => {
    const { json: { code } } = await srv.call('POST', '/api/link-code', { token: alice.token });
    await new Promise(r => setTimeout(r, 2300));
    const r = await srv.call('POST', '/api/link-gmail', { token: tok({ email: 'late@gmail.com' }), body: { code } });
    assert.equal(r.status, 400); assert.equal(r.json.code, 'bad_code');
  });
  test('guessing codes is limited to 5 tries', async () => {
    const id = tok({ email: 'guesser@gmail.com' });
    for (let i = 0; i < 5; i++) assert.equal((await srv.call('POST', '/api/link-gmail', { token: id, body: { code: `GUES-S${i}XX` } })).status, 400);
    const blocked = await srv.call('POST', '/api/link-gmail', { token: id, body: { code: 'GUES-SXXX' } });
    assert.equal(blocked.status, 429);
    const { json: { code } } = await srv.call('POST', '/api/link-code', { token: alice.token });
    assert.equal((await srv.call('POST', '/api/link-gmail', { token: id, body: { code } })).status, 429, 'even a correct code is refused while blocked');
  });
  test('Gmail sign-in is off unless the server is configured for it (and keys keep working)', async () => {
    const user = await off.signup();
    const r = await off.call('POST', '/api/analyze', { token: tok({}), body: { body: 'x' } });
    assert.equal(r.status, 501); assert.equal(r.json.code, 'google_disabled');
    assert.equal((await off.call('POST', '/api/analyze', { token: user.token, body: { body: 'x' } })).status, 200);
    assert.equal((await off.call('POST', '/api/link-gmail', { token: tok({}), body: { code: 'AAAA-BBBB' } })).status, 501);
  });
});
