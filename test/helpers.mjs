// Shared test helpers: a fake "Google" (signing key + key server), Google-style tokens, and a way to start the real server on a temp database.
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUD = 'test-client-123.apps.googleusercontent.com';
const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
export const nowSec = () => Math.floor(Date.now() / 1000);

export function newKeyPair(kid = 'k1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, publicKey, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' } };
}

/** Build a signed Google-style ID token. Pass overrides to make it wrong in a specific way. */
export function makeToken({ pair, header = {}, payload = {}, tamper = false } = {}) {
  const h = b64u({ alg: 'RS256', kid: pair.kid, typ: 'JWT', ...header });
  const p = b64u({ iss: 'https://accounts.google.com', aud: AUD, sub: '1001', email: 'rosa@gmail.com', email_verified: true, iat: nowSec(), exp: nowSec() + 3600, ...payload });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), pair.privateKey).toString('base64url');
  if (tamper) return `${h}.${b64u({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'victim@gmail.com' })}.${sig}`;   // payload changed after signing
  return `${h}.${p}.${sig}`;
}

/** A tiny stand-in for Google's key server. */
export async function startKeyServer(pairs) {
  const state = { pairs, hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits++;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
    res.end(JSON.stringify({ keys: state.pairs.map(p => p.jwk) }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { state, url: `http://127.0.0.1:${server.address().port}/certs`, close: () => new Promise(r => server.close(r)) };
}

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/** Start the real server against a fresh temporary database. */
export async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swiv-test-'));
  for (const f of ['catalog.db', 'live_schema.sql']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(dir, f));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), SWIVEL_DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', d => { logs += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start:\n' + logs)), 8000);
    child.stdout.on('data', d => { logs += d; if (String(d).includes('Swivel running')) { clearTimeout(t); resolve(); } });
    child.on('exit', c => { clearTimeout(t); reject(new Error(`server exited early (${c}):\n${logs}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, route, { token, body, headers } = {}) => {
    const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: method === 'GET' ? undefined : body && JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
  };
  let n = 0;
  const signup = async (overrides = {}) => {
    n++;
    const r = await call('POST', '/api/signup', { body: { fullName: `Test User${n}`, email: `user${n}-${Date.now()}@example.com`, password: 'longenough1', state: 'FL', ageGroup: '60+', language: 'English', ...overrides } });
    if (r.status !== 201) throw new Error('signup failed: ' + JSON.stringify(r));
    return r.json;
  };
  return { call, signup, logs: () => logs, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
