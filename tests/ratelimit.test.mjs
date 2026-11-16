import test from 'node:test';
import assert from 'node:assert/strict';
import { stubFetch, jsonResponse, setEnv, mockReq, mockRes } from './helpers.mjs';
import { checkRateLimit, LIMITI } from '../server/ratelimit.js';
import { uguali } from '../server/auth.js';
import wdi from '../api/v1/wdi.js';

/** Finto Redis in memoria: INCR + EXPIRE con supporto NX; registra i TTL impostati. */
function redisFinto({ supportaNX = true } = {}) {
  const st = new Map(); // key -> { n, ttl }
  const log = [];
  const risposta = (url, opts) => {
    const cmds = JSON.parse(opts.body);
    const out = cmds.map((c) => {
      log.push(c);
      const [cmd, key, ...r] = c;
      if (cmd === 'INCR') { const e = st.get(key) || { n: 0, ttl: null }; e.n++; st.set(key, e); return { result: e.n }; }
      if (cmd === 'EXPIRE') {
        const e = st.get(key); const nx = r[1] === 'NX';
        if (nx && !supportaNX) return { error: 'ERR syntax error' };
        if (nx && e.ttl !== null) return { result: 0 };
        e.ttl = r[0]; e.ttlSet = (e.ttlSet || 0) + 1; return { result: 1 };
      }
      return { error: 'cmd' };
    });
    return jsonResponse(out);
  };
  return { st, log, risposta };
}

test('rate limit: il TTL viene impostato una volta sola (non si rinnova ad ogni richiesta)', async () => {
  const r = setEnv({ UPSTASH_REDIS_REST_URL: 'https://redis.finto', UPSTASH_REDIS_REST_TOKEN: 't' });
  const redis = redisFinto(); const f = stubFetch(redis.risposta);
  try {
    for (let i = 0; i < 12; i++) await checkRateLimit('1.2.3.4', 'import');
    const e = redis.st.get('wiztrail:ratelimit:import:1.2.3.4');
    assert.equal(e.n, 12);
    assert.equal(e.ttlSet, 1, 'EXPIRE deve applicarsi solo alla prima richiesta della finestra');
    assert.ok(redis.log.filter(c => c[0] === 'EXPIRE').every(c => c[3] === 'NX'));
  } finally { f.ripristina(); r(); }
});

test('rate limit: scope separati con limiti propri (import 10/min)', async () => {
  const r = setEnv({ UPSTASH_REDIS_REST_URL: 'https://redis.finto', UPSTASH_REDIS_REST_TOKEN: 't' });
  const redis = redisFinto(); const f = stubFetch(redis.risposta);
  try {
    let ultimo;
    for (let i = 0; i < LIMITI.import; i++) ultimo = await checkRateLimit('9.9.9.9', 'import');
    assert.equal(ultimo.allowed, true);
    const oltre = await checkRateLimit('9.9.9.9', 'import');
    assert.equal(oltre.allowed, false);
    assert.equal(oltre.retryAfter, 60);
    const altroScope = await checkRateLimit('9.9.9.9', 'v1');
    assert.equal(altroScope.allowed, true, 'un altro endpoint ha il suo contatore');
  } finally { f.ripristina(); r(); }
});

test('rate limit: fallback se Redis non supporta EXPIRE NX (TTL solo alla prima richiesta)', async () => {
  const r = setEnv({ UPSTASH_REDIS_REST_URL: 'https://redis.finto', UPSTASH_REDIS_REST_TOKEN: 't' });
  const redis = redisFinto({ supportaNX: false }); const f = stubFetch(redis.risposta);
  try {
    for (let i = 0; i < 5; i++) await checkRateLimit('5.5.5.5', 'feedback');
    const e = redis.st.get('wiztrail:ratelimit:feedback:5.5.5.5');
    assert.equal(e.ttlSet, 1);
  } finally { f.ripristina(); r(); }
});

test('rate limit: fail-open se Redis risponde errore HTTP o non e\' configurato', async () => {
  let r = setEnv({ UPSTASH_REDIS_REST_URL: 'https://redis.finto', UPSTASH_REDIS_REST_TOKEN: 't' });
  let f = stubFetch(() => new Response('boom', { status: 500 }));
  try { assert.equal((await checkRateLimit('1.1.1.1')).allowed, true); } finally { f.ripristina(); r(); }
  r = setEnv({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
  try { assert.equal((await checkRateLimit('1.1.1.1')).allowed, true); } finally { r(); }
});

test('v1: il rate limit scatta PRIMA del controllo della chiave (nessun GET Redis per chiavi errate quando bloccati)', async () => {
  const r = setEnv({ UPSTASH_REDIS_REST_URL: 'https://redis.finto', UPSTASH_REDIS_REST_TOKEN: 't', API_KEYS: 'giusta' });
  const redis = redisFinto();
  const f = stubFetch((url, opts) => url.includes('/get/') ? jsonResponse({ result: null }) : redis.risposta(url, opts));
  try {
    for (let i = 0; i < LIMITI.v1; i++) { const res = mockRes(); await wdi(mockReq({ method: 'POST', headers: { 'x-api-key': 'sbagliata' }, body: {} }), res); assert.equal(res.statusCode, 401); }
    const getPrima = f.chiamate.filter(c => c.url.includes('/get/')).length;
    const res = mockRes(); await wdi(mockReq({ method: 'POST', headers: { 'x-api-key': 'sbagliata' }, body: {} }), res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.code, 'RATE_LIMITED');
    assert.ok(res.headers['retry-after']);
    assert.equal(f.chiamate.filter(c => c.url.includes('/get/')).length, getPrima, 'nessuna lettura chiave dopo il blocco');
  } finally { f.ripristina(); r(); }
});

test('auth: confronto chiave a tempo costante', () => {
  assert.equal(uguali('wt_abc', 'wt_abc'), true);
  assert.equal(uguali('wt_abc', 'wt_abd'), false);
  assert.equal(uguali('a', 'aaaa'), false);
});
