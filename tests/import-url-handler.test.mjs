import test from 'node:test';
import assert from 'node:assert/strict';
import { mockReq, mockRes, setEnv } from './helpers.mjs';
import handler from '../api/import/url.js';

// Senza variabili Upstash il rate limit e' fail-open: nessun Redis viene contattato.
const env = () => setEnv({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });

async function chiama(query) {
  const res = mockRes();
  await handler(mockReq({ query }), res);
  return res;
}

test('url mancante -> 400 MISSING_URL', async () => {
  const r = env(); try { const res = await chiama({}); assert.equal(res.statusCode, 400); assert.equal(res.body.code, 'MISSING_URL'); } finally { r(); }
});
test('[::1] -> 400 BLOCKED_HOST (prima passava)', async () => {
  const r = env(); try { const res = await chiama({ url: 'http://[::1]/' }); assert.equal(res.statusCode, 400); assert.equal(res.body.code, 'BLOCKED_HOST'); assert.equal(res.body.ok, false); } finally { r(); }
});
test('127.0.0.1 -> 400', async () => {
  const r = env(); try { const res = await chiama({ url: 'http://127.0.0.1/' }); assert.equal(res.statusCode, 400); } finally { r(); }
});
test('schema ftp -> 400 UNSUPPORTED_SCHEME', async () => {
  const r = env(); try { const res = await chiama({ url: 'ftp://x.it/a' }); assert.equal(res.body.code, 'UNSUPPORTED_SCHEME'); } finally { r(); }
});
test('metodo POST -> 405', async () => {
  const r = env(); try { const res = mockRes(); await handler(mockReq({ method: 'POST' }), res); assert.equal(res.statusCode, 405); } finally { r(); }
});
