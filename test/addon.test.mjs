// Runs gmail-addon/Code.gs against stand-ins for Google's services (CardService, UrlFetchApp, ScriptApp ...) to check every path:
// key mode, Google sign-in mode, first-time linking, and each kind of error. It cannot prove Google's real services behave the same.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const SOURCE = fs.readFileSync(path.join(ROOT, 'gmail-addon', 'Code.gs'), 'utf8');
const API = 'https://demo.example.net';
const GOOD = { level: 'high', headline: 'Very likely a scam.', scam: { name: 'Fake package delivery', summary: 'A text posing as USPS.', tips: ['Do not tap the link.', 'Delete the text.'] }, hits: ['redelivery fee', 'usps'], community: 4, recovery: ['Call your bank.'] };
const jwt = claims => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

function load({ props = { SWIVEL_API: API }, idToken = null, responses = {}, throws = false } = {}) {
  const log = { strings: [], fetches: [] };
  const recorder = () => {                       // any chain of CardService calls works; every string argument is recorded
    const make = () => new Proxy(function () {}, {
      get: (_, name) => name === 'build' ? () => ({ built: true }) : make(),
      apply: (_, __, args) => { for (const a of args) if (typeof a === 'string') log.strings.push(a); return make(); },
    });
    return make();
  };
  const ctx = {
    CardService: recorder(),
    PropertiesService: { getScriptProperties: () => ({ getProperty: n => props[n] ?? null }) },
    ScriptApp: { getIdentityToken: () => idToken },
    GmailApp: { setCurrentMessageAccessToken() {}, getMessageById: () => ({ getSubject: () => 'Re: your parcel', getPlainBody: () => 'Pay the redelivery fee now' }) },
    UrlFetchApp: {
      fetch(url, opts) {
        log.fetches.push({ url, opts, body: JSON.parse(opts.payload) });
        if (throws) throw new Error('network down');
        const r = responses[new URL(url).pathname] || { status: 200, body: GOOD };
        return { getResponseCode: () => r.status, getContentText: () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body) };
      },
    },
    Utilities: { base64DecodeWebSafe: s => Buffer.from(s, 'base64url'), newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }) },
  };
  vm.createContext(ctx); vm.runInContext(SOURCE, ctx);
  return { ctx, log, text: () => log.strings.join('\n'), last: () => log.fetches.at(-1) };
}
const open = { gmail: { accessToken: 't', messageId: 'm' } };

describe('key mode (SWIVEL_TOKEN set)', () => {
  test('sends the key and shows the result card with tips', () => {
    const a = load({ props: { SWIVEL_API: API + '/', SWIVEL_TOKEN: 'KEY123' } });
    a.ctx.onMessageOpen(open);
    assert.equal(a.last().url, `${API}/api/analyze`, 'trailing slash removed');
    assert.equal(a.last().opts.headers.Authorization, 'Bearer KEY123');
    assert.deepEqual(a.last().body, { subject: 'Re: your parcel', body: 'Pay the redelivery fee now' });
    for (const s of ['Very likely a scam.', 'Fake package delivery', 'redelivery fee, usps', 'Do not tap the link.<br>• Delete the text.', 'Call your bank.', '4 people like you']) assert.match(a.text(), new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), s);
  });
  test('says so when the key is not accepted', () => {
    const a = load({ props: { SWIVEL_API: API, SWIVEL_TOKEN: 'bad' }, responses: { '/api/analyze': { status: 401, body: { error: 'Not signed in.' } } } });
    a.ctx.onMessageOpen(open); assert.match(a.text(), /Key not accepted/);
  });
});

describe('Google sign-in mode', () => {
  test('sends the Google token when no key is set', () => {
    const a = load({ idToken: 'aaa.bbb.ccc' });
    a.ctx.onMessageOpen(open);
    assert.equal(a.last().opts.headers.Authorization, 'Bearer aaa.bbb.ccc');
    assert.match(a.text(), /Very likely a scam/);
  });
  test('a Gmail address that is not linked yet gets the link card', () => {
    const a = load({ idToken: 'aaa.bbb.ccc', responses: { '/api/analyze': { status: 404, body: { code: 'not_linked', error: 'not linked' } } } });
    a.ctx.onMessageOpen(open);
    assert.match(a.text(), /Link your SwivProtect account/); assert.match(a.text(), /linkAccount/); assert.match(a.text(), /Get a link code/);
    assert.doesNotMatch(a.text(), /Very likely/);
  });
  test('linking: sends the typed code and confirms', () => {
    const a = load({ idToken: 'aaa.bbb.ccc', responses: { '/api/link-gmail': { status: 200, body: { linked: true, email: 'rosa@gmail.com' } } } });
    a.ctx.linkAccount({ formInput: { code: '  ABCD-EFGH ' } });
    assert.equal(a.last().url, `${API}/api/link-gmail`); assert.deepEqual(a.last().body, { code: 'ABCD-EFGH' });
    assert.equal(a.last().opts.headers.Authorization, 'Bearer aaa.bbb.ccc');
    assert.match(a.text(), /Linked! Open an email to check it/); assert.match(a.text(), /now linked/);
  });
  test('linking: shows the server\'s message for a wrong code, and asks for a code if the box is empty', () => {
    const bad = load({ idToken: 'a.b.c', responses: { '/api/link-gmail': { status: 400, body: { error: 'That code is not valid or has expired.' } } } });
    bad.ctx.linkAccount({ formInput: { code: 'WRONG' } }); assert.match(bad.text(), /not valid or has expired/);
    const empty = load({ idToken: 'a.b.c' });
    empty.ctx.linkAccount({ formInput: {} }); empty.ctx.linkAccount({});
    assert.match(empty.text(), /Type the code/); assert.equal(empty.log.fetches.length, 0, 'no request without a code');
  });
  test('linking: a network failure is reported, not thrown', () => {
    const a = load({ idToken: 'a.b.c', throws: true });
    a.ctx.linkAccount({ formInput: { code: 'ABCD-EFGH' } }); assert.match(a.text(), /Could not reach SwivProtect: network down/);
  });
  test('no Google token and no key: asks for permission and sends nothing', () => {
    const a = load({ idToken: null });
    a.ctx.onMessageOpen(open); assert.match(a.text(), /Permission needed/); assert.equal(a.log.fetches.length, 0);
  });
  test('Google sign-in rejected / switched off / Google unreachable', () => {
    const cases = [[401, /Google sign-in not accepted/], [501, /Gmail sign-in is off/], [503, /Please try again/], [429, /Please slow down/], [500, /code 500/]];
    for (const [status, re] of cases) {
      const a = load({ idToken: 'a.b.c', responses: { '/api/analyze': { status, body: {} } } });
      a.ctx.onMessageOpen(open); assert.match(a.text(), re, String(status));
    }
  });
});

describe('problems that apply to both modes', () => {
  test('no server address set', () => {
    const a = load({ props: {} }); a.ctx.onMessageOpen(open);
    assert.match(a.text(), /Setup needed/); assert.equal(a.log.fetches.length, 0);
  });
  test('server unreachable', () => {
    const a = load({ idToken: 'a.b.c', throws: true }); a.ctx.onMessageOpen(open);
    assert.match(a.text(), /Could not reach SwivProtect/);
  });
  test('a web page (such as a tunnel warning) instead of an answer is explained, not shown as "undefined"', () => {
    const a = load({ idToken: 'a.b.c', responses: { '/api/analyze': { status: 200, body: '<!doctype html><title>tunnel</title>' } } });
    a.ctx.onMessageOpen(open); assert.match(a.text(), /Unexpected answer/); assert.doesNotMatch(a.text(), /undefined/);
  });
  test('a low-risk email shows the green card without a scam section', () => {
    const a = load({ idToken: 'a.b.c', responses: { '/api/analyze': { status: 200, body: { level: 'low', headline: 'Nothing obviously wrong.', scam: null, hits: [], community: 0, recovery: null } } } });
    a.ctx.onMessageOpen(open); assert.match(a.text(), /Nothing obviously wrong/); assert.doesNotMatch(a.text(), /undefined|Looks like/);
  });
});

describe('home card and setup helper', () => {
  test('shows the Gmail address and audience only when SWIVEL_DEBUG is 1', () => {
    const token = jwt({ email: 'rosa@gmail.com', aud: 'client-abc.apps.googleusercontent.com' });
    const on = load({ props: { SWIVEL_API: API, SWIVEL_DEBUG: '1' }, idToken: token }); on.ctx.onHomepage();
    assert.match(on.text(), /rosa@gmail\.com/); assert.match(on.text(), /client-abc\.apps\.googleusercontent\.com/);
    const off = load({ idToken: token }); off.ctx.onHomepage();
    assert.match(off.text(), /Open an email/); assert.doesNotMatch(off.text(), /client-abc/);
    const none = load({ props: { SWIVEL_API: API, SWIVEL_DEBUG: '1' }, idToken: null }); none.ctx.onHomepage();
    assert.match(none.text(), /No Google sign-in token/);
  });
});
