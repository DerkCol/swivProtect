// Abuse protection: request size, field lengths, rate limits, lockout, cross-site access, safe headers, and the test-only settings.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleVerifier } from '../googleAuth.js';
import { startServer } from './helpers.mjs';

const account = (i, o = {}) => ({ fullName: `Test ${i}`, email: `t${i}-${Date.now()}@example.com`, password: 'longenough1', state: 'FL', ageGroup: '60+', language: 'English', ...o });
const limits = o => ({ RATE_LIMITS: JSON.stringify(o) });
const BIG = 1_000_000;    // "no limit" for the allowances a test is not about

describe('size and length limits', () => {
  let srv, user;
  before(async () => { srv = await startServer({}); user = await srv.signup(); });
  after(() => srv.stop());

  test('an oversized request is refused without being read, and the server stays healthy', async () => {
    let r; try { r = await srv.call('POST', '/api/signup', { body: { junk: 'x'.repeat(150_000) } }); } catch { r = { status: 'connection closed' }; }
    assert.ok(r.status === 413 || r.status === 'connection closed', String(r.status));
    if (r.status === 413) assert.equal(r.json.code, 'too_large');
    assert.equal((await srv.call('GET', '/api/options')).status, 200);
  });
  test('name, email and password have length limits', async () => {
    assert.equal((await srv.call('POST', '/api/signup', { body: account(1, { fullName: 'N'.repeat(81) }) })).status, 400);
    assert.equal((await srv.call('POST', '/api/signup', { body: account(2, { email: 'a'.repeat(250) + '@x.com' }) })).status, 400);
    assert.equal((await srv.call('POST', '/api/signup', { body: account(3, { password: 'a1' + 'b'.repeat(127) }) })).status, 400);
    assert.equal((await srv.call('POST', '/api/signup', { body: account(4, { fullName: 'N'.repeat(80) }) })).status, 201);
  });
  test('only the start of a very long message is scanned', async () => {
    const scam = 'IRS arrest warrant, pay back taxes with gift cards. ';
    const early = await srv.call('POST', '/api/analyze', { token: user.token, body: { body: scam + 'x '.repeat(40_000) } });
    const late = await srv.call('POST', '/api/analyze', { token: user.token, body: { body: 'x '.repeat(40_000) + scam } });
    assert.equal(early.status, 200); assert.equal(early.json.level, 'high');
    assert.equal(late.status, 200); assert.equal(late.json.level, 'low');
  });
});

describe('rate limits (small allowances so the tests run fast)', () => {
  let srv, alice, bob, extra = [];
  before(async () => {
    srv = await startServer(limits({ signupIp: 4, signupAll: BIG, loginIp: BIG, loginFail: 3, analyzeUser: 5, analyzeIp: BIG, reportUser: 2, linkCodeUser: 2, readUser: 8, readIp: BIG }));
    alice = await srv.signup(); bob = await srv.signup();          // two of the four allowed sign-ups
    alice.email = (await srv.call('GET', '/api/me', { token: alice.token })).json.email;
  });
  after(() => srv.stop());

  test('sign-ups per address: refused with how long to wait', async () => {
    for (let i = 0; i < 2; i++) { const r = await srv.call('POST', '/api/signup', { body: account(10 + i) }); assert.equal(r.status, 201); extra.push(r.json); }
    const r = await srv.call('POST', '/api/signup', { body: account(12) });
    assert.equal(r.status, 429); assert.equal(r.json.code, 'rate_limited');
    assert.ok(Number(r.headers.get('retry-after')) > 0, 'a Retry-After header tells clients how long to wait');
  });
  test('wrong passwords lock that account, but not other accounts', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await srv.call('POST', '/api/login', { body: { email: alice.email, password: 'wrong-pass' + i } })).status, 401);
    const locked = await srv.call('POST', '/api/login', { body: { email: alice.email, password: 'wrong-pass-again' } });
    assert.equal(locked.status, 429); assert.equal(locked.json.code, 'locked');
    assert.equal((await srv.call('POST', '/api/login', { body: { email: alice.email, password: 'longenough1' } })).status, 429, 'even the right password waits');
    assert.equal((await srv.call('POST', '/api/login', { body: { email: bob.email, password: 'longenough1' } })).status, 200, 'other accounts are unaffected');
  });
  test('message checks are limited per person', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await srv.call('POST', '/api/analyze', { token: alice.token, body: { body: 'hello' } })).status, 200);
    assert.equal((await srv.call('POST', '/api/analyze', { token: alice.token, body: { body: 'hello' } })).status, 429);
    assert.equal((await srv.call('POST', '/api/analyze', { token: bob.token, body: { body: 'hello' } })).status, 200, 'someone else is not slowed down');
  });
  test('reports and link codes are limited per person', async () => {
    for (const scamId of [1, 2]) assert.equal((await srv.call('POST', '/api/reports', { token: bob.token, body: { scamId, source: 'SMS', outcome: 'unsure' } })).status, 201);
    assert.equal((await srv.call('POST', '/api/reports', { token: bob.token, body: { scamId: 3, source: 'SMS', outcome: 'unsure' } })).status, 429);
    for (let i = 0; i < 2; i++) assert.equal((await srv.call('POST', '/api/link-code', { token: bob.token })).status, 200);
    assert.equal((await srv.call('POST', '/api/link-code', { token: bob.token })).status, 429);
  });
  test('refreshing is limited per person, and other people are not affected', async () => {
    const [a] = extra;
    for (let i = 0; i < 8; i++) assert.equal((await srv.call('GET', '/api/my-reports', { token: a.token })).status, 200);
    assert.equal((await srv.call('GET', '/api/my-reports', { token: a.token })).status, 429);
    assert.equal((await srv.call('GET', '/api/my-reports', { token: extra[1].token })).status, 200);
  });
});

describe('limits per address and overall', () => {
  test('an address cannot get around its allowance by lying in X-Forwarded-For (the default)', async () => {
    const srv = await startServer(limits({ readIp: 3 }));
    try {
      for (let i = 0; i < 3; i++) assert.equal((await srv.call('GET', '/api/options', { headers: { 'x-forwarded-for': `9.9.9.${i}` } })).status, 200);
      assert.equal((await srv.call('GET', '/api/options', { headers: { 'x-forwarded-for': '9.9.9.99' } })).status, 429);
    } finally { srv.stop(); }
  });
  test('behind a proxy you control (TRUST_PROXY=1) people are told apart by X-Forwarded-For', async () => {
    const srv = await startServer({ TRUST_PROXY: '1', ...limits({ readIp: 2 }) });
    try {
      const ask = ip => srv.call('GET', '/api/options', { headers: { 'x-forwarded-for': ip } });
      assert.equal((await ask('1.1.1.1')).status, 200); assert.equal((await ask('1.1.1.1')).status, 200);
      assert.equal((await ask('1.1.1.1')).status, 429);
      assert.equal((await ask('2.2.2.2')).status, 200, 'a different address has its own allowance');
    } finally { srv.stop(); }
  });
  test('an overall sign-up cap bounds how fast the user table can grow, whoever is asking', async () => {
    const srv = await startServer(limits({ signupIp: BIG, signupAll: 3 }));
    try {
      const r = [];
      for (let i = 0; i < 5; i++) r.push((await srv.call('POST', '/api/signup', { body: account(20 + i) })).status);
      assert.deepEqual(r, [201, 201, 201, 429, 429]);
    } finally { srv.stop(); }
  });
  test('RATE_LIMITS=off really switches them off (development only)', async () => {
    const srv = await startServer({ RATE_LIMITS: 'off' });
    try {
      const r = await Promise.all(Array.from({ length: 70 }, (_, i) => srv.call('POST', '/api/signup', { body: account(100 + i) })));
      assert.equal(r.filter(x => x.status === 201).length, 70, 'more than the default 60 an hour');
    } finally { srv.stop(); }
  });
});

describe('cross-site access, headers and test-only settings', () => {
  let srv;
  before(async () => { srv = await startServer({}); });
  after(() => srv.stop());

  test('no web page on another site is allowed to use the API from a visitor\'s browser', async () => {
    const r = await srv.call('GET', '/api/options', { headers: { origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const pre = await srv.call('OPTIONS', '/api/signup', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 405); assert.equal(pre.headers.get('access-control-allow-origin'), null);
  });
  test('safe headers on API answers and on the pages', async () => {
    const api = await srv.call('GET', '/api/options'), page = await srv.call('GET', '/');
    for (const r of [api, page]) {
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    }
    assert.equal(api.headers.get('cache-control'), 'no-store');
  });
  test('unexpected server errors never show details to the caller', async () => {
    const r = await srv.call('POST', '/api/analyze', { token: 'x', body: {} });
    assert.equal(r.status, 401); assert.deepEqual(Object.keys(r.json).sort(), ['error']);
  });
  test('the Google key address must be https (plain http only for localhost, as the tests use)', async () => {
    assert.throws(() => createGoogleVerifier({ audiences: ['a'], jwksUrl: 'http://evil.example.com/certs' }), /https/);
    assert.doesNotThrow(() => createGoogleVerifier({ audiences: ['a'], jwksUrl: 'http://127.0.0.1:9999/certs' }));
    assert.doesNotThrow(() => createGoogleVerifier({ audiences: ['a'], jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs' }));
    await assert.rejects(startServer({ GOOGLE_AUDIENCE: 'a', GOOGLE_JWKS_URL: 'http://evil.example.com/certs' }), /exited early/, 'the server refuses to start with an insecure key address');
  });
});
