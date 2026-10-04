// Deployment support: the health check and binding to the inside address only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { startServer } from './helpers.mjs';

const lanAddress = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const reach = async (host, port) => { try { return (await fetch(`http://${host}:${port}/healthz`, { signal: AbortSignal.timeout(3000) })).status; } catch { return 'unreachable'; } };

describe('health check', () => {
  test('/healthz answers ok, needs no login, and is never rate limited', async () => {
    const srv = await startServer({ RATE_LIMITS: JSON.stringify({ readIp: 2 }) });
    try {
      for (let i = 0; i < 20; i++) assert.equal((await fetch(`http://127.0.0.1:${srv.port}/healthz`)).status, 200);
      const r = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
      assert.equal(await r.text(), 'ok'); assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal((await srv.call('GET', '/api/options')).status, 200);   // the real API still has its own allowance, untouched by the health checks
    } finally { srv.stop(); }
  });
});

describe('HOST binding', { skip: lanAddress ? false : 'no network address to test with' }, () => {
  test('default: answers on every address; HOST=127.0.0.1: only on the inside address, so it can sit safely behind a proxy', async (t) => {
    const open = await startServer({});
    let canReachItself;
    try { canReachItself = (await reach(lanAddress, open.port)) === 200; } finally { open.stop(); }
    if (!canReachItself) return t.skip('this machine cannot reach its own network address (a firewall, perhaps), so binding cannot be shown here');
    const inside = await startServer({ HOST: '127.0.0.1' });
    try { assert.equal(await reach('127.0.0.1', inside.port), 200); assert.equal(await reach(lanAddress, inside.port), 'unreachable'); } finally { inside.stop(); }
  });
});
