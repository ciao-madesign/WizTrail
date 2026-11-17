// Una preview Vercel (stesse credenziali Upstash) non deve poter toccare i dati di produzione
// ne' generare effetti esterni (GitHub Actions, email, nuove chiavi).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockReq, mockRes, stubFetch, jsonResponse, setEnv } from './helpers.mjs';
import { ns } from '../server/redis.js';

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.finto';
process.env.UPSTASH_REDIS_REST_TOKEN = 't';
process.env.HUB_SECRET_TOKEN = 's';
process.env.HUB_ADMIN_TOKEN = 'admin';
process.env.GITHUB_TOKEN = 'gh';
process.env.GITHUB_REPO = 'org/repo';
const { default: hub } = await import('../api/hub.js');
const { checkRateLimit } = await import('../server/ratelimit.js');
const { checkApiKey } = await import('../server/auth.js');

test('namespace: solo production usa wiztrail:, gli altri ambienti sono isolati', () => {
  const casi = [['production', 'wiztrail:'], ['preview', 'wiztrail:preview:'], ['development', 'wiztrail:development:'], [undefined, 'wiztrail:locale:']];
  for (const [env, atteso] of casi) {
    const r = setEnv({ VERCEL_ENV: env });
    try { assert.equal(ns(), atteso); } finally { r(); }
  }
});

function redisSpia() {
  const chiavi = [];
  const f = stubFetch((url, opts) => {
    if (url.includes('/get/')) chiavi.push(decodeURIComponent(url.split('/get/')[1]));
    else if (url.includes('/scan/')) { chiavi.push(decodeURIComponent(new URL(url).searchParams.get('match'))); return jsonResponse({ result: ['0', []] }); }
    else if (opts && opts.body) for (const c of JSON.parse(opts.body)) if (typeof c[1] === 'string') chiavi.push(c[1]);
    return jsonResponse(url.endsWith('/pipeline') ? [{ result: 1 }, { result: 1 }] : { result: null });
  });
  return { chiavi, f };
}

test('preview: rate limit e auth key usano solo chiavi con prefisso preview (mai wiztrail:ratelimit/apikeys di production)', async () => {
  const r = setEnv({ VERCEL_ENV: 'preview', API_KEYS: undefined });
  const s = redisSpia();
  try {
    await checkRateLimit('1.2.3.4', 'import');
    await checkApiKey({ headers: { 'x-api-key': 'wt_qualsiasi' } });
    assert.ok(s.chiavi.length >= 2);
    for (const k of s.chiavi) assert.ok(k.startsWith('wiztrail:preview:'), `chiave fuori namespace: ${k}`);
  } finally { s.f.ripristina(); r(); }
});

test('preview: azioni hub di lettura/scrittura dati usano solo il namespace preview', async () => {
  const r = setEnv({ VERCEL_ENV: 'preview' });
  const s = redisSpia();
  try {
    const res = mockRes();
    await hub(mockReq({ method: 'GET', query: { action: 'activities', key: 'admin' } }), res);
    assert.equal(res.statusCode, 200);
    const res2 = mockRes();
    await hub(mockReq({ method: 'POST', query: { action: 'feedback' }, headers: { origin: 'https://wiz-trail.vercel.app' }, body: { delta_pct: 5, km: 10, dplus: 100 } }), res2);
    assert.ok(s.chiavi.length > 0);
    for (const k of s.chiavi) assert.ok(k.startsWith('wiztrail:preview:'), `chiave fuori namespace: ${k}`);
  } finally { s.f.ripristina(); r(); }
});

for (const [azione, metodo, body] of [['run', 'POST', { alias: 'x' }], ['register', 'POST', { description: 'test' }], ['requestkey', 'POST', { email: 'a@b.it' }]]) {
  test(`preview/locale: ${azione} bloccata (403 PREVIEW_DISABLED), nessuna chiamata esterna`, async () => {
    for (const env of ['preview', 'development', null]) {
      const r = setEnv({ VERCEL_ENV: env === null ? undefined : env });
      const f = stubFetch();
      try {
        const res = mockRes();
        await hub(mockReq({ method: metodo, query: { action: azione, key: 'admin' }, body }), res);
        assert.equal(res.statusCode, 403, `${azione} in ${env}`);
        assert.equal(res.body.code, 'PREVIEW_DISABLED');
        assert.equal(f.chiamate.length, 0, 'nessun fetch (GitHub/Resend/Redis) consentito');
      } finally { f.ripristina(); r(); }
    }
  });
}

test('production: run non e\' bloccata dal guard (arriva fino al controllo successivo)', async () => {
  const r = setEnv({ VERCEL_ENV: 'production' });
  const f = stubFetch((url) => jsonResponse(url.includes('/get/') ? { result: null } : [{ result: 'OK' }]));
  try {
    const res = mockRes();
    await hub(mockReq({ method: 'POST', query: { action: 'run', key: 'admin' }, body: { alias: 'x' } }), res);
    assert.notEqual(res.body?.code, 'PREVIEW_DISABLED');
  } catch (e) { /* un eventuale errore a valle (GitHub finto) e' irrilevante: conta solo che il guard non scatti */ }
  finally { f.ripristina(); r(); }
});
