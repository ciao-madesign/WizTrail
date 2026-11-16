// Le costanti di hub.js sono lette all'import: impostare le env PRIMA dell'import dinamico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockReq, mockRes, stubFetch, jsonResponse } from './helpers.mjs';

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.finto';
process.env.UPSTASH_REDIS_REST_TOKEN = 't';
process.env.RESEND_API_KEY = 're_finta';
process.env.HUB_SECRET_TOKEN = 's';
process.env.HUB_ADMIN_TOKEN = 'a';
const hub = await import('../api/hub.js');
const handler = hub.default;
const { escapeHtml, pulisciDescrizione, buildKeyEmail } = hub;

/** Finto Redis + Resend in memoria. */
function mondoFinto() {
  const kv = new Map(); const mail = []; const cmdLog = [];
  const f = stubFetch((url, opts) => {
    if (url.startsWith('https://api.resend.com')) { mail.push(JSON.parse(opts.body)); return jsonResponse({ id: 'm1' }); }
    if (url.includes('/get/')) {
      const k = decodeURIComponent(url.split('/get/')[1]);
      return jsonResponse({ result: kv.has(k) ? kv.get(k) : null });
    }
    if (url.endsWith('/pipeline')) {
      const cmds = JSON.parse(opts.body);
      return jsonResponse(cmds.map((c) => {
        cmdLog.push(c);
        const [cmd, key, ...r] = c;
        if (cmd === 'INCR') { const n = (kv.get(key) || 0) + 1; kv.set(key, n); return { result: n }; }
        if (cmd === 'EXPIRE') return { result: 1 };
        if (cmd === 'SET') { const nx = r.includes('NX'); if (nx && kv.has(key)) return { result: null }; kv.set(key, r[0]); return { result: 'OK' }; }
        if (cmd === 'SADD') return { result: 1 };
        return { result: null };
      }));
    }
    throw new Error('fetch inatteso ' + url);
  });
  return { kv, mail, cmdLog, f };
}

async function chiama(body, { env = 'production', ip = '198.51.100.7' } = {}) {
  const prima = process.env.VERCEL_ENV;
  if (env === null) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
  try {
    const res = mockRes();
    await handler(mockReq({ method: 'POST', query: { action: 'requestkey' }, body, headers: { 'x-forwarded-for': ip } }), res);
    return res;
  } finally { if (prima === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = prima; }
}

test('escapeHtml neutralizza tag e virgolette', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});

test('pulisciDescrizione: una riga, max 80 caratteri', () => {
  const d = pulisciDescrizione('a\nb\r\nc ' + 'x'.repeat(200));
  assert.ok(d.length <= 80); assert.ok(!/[\n\r]/.test(d));
});

test('email: la descrizione HTML non compare mai non escapata', () => {
  const html = buildKeyEmail('wt_abc', '<img src=x onerror=alert(1)><a href="https://phishing.example">clicca</a>');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<a href="https://phishing'));
  assert.ok(html.includes('&lt;img'));
});

test('email: il footer non dice piu\' che la chiave non e\' attiva', () => {
  assert.ok(!/non è attiva/.test(buildKeyEmail('wt_abc', 'x')));
});

test('non-production (preview/locale): requestkey disabilitata, nessuna email, nessun Redis', async () => {
  const w = mondoFinto();
  try {
    for (const env of ['preview', 'development', null]) {
      const res = await chiama({ email: 'a@b.it' }, { env });
      assert.equal(res.statusCode, 403); assert.equal(res.body.code, 'PREVIEW_DISABLED');
    }
    assert.equal(w.f.chiamate.length, 0);
  } finally { w.f.ripristina(); }
});

test('production: email non valida -> 400', async () => {
  const w = mondoFinto();
  try { const res = await chiama({ email: 'non-una-email' }); assert.equal(res.statusCode, 400); assert.equal(res.body.code, 'INVALID_EMAIL'); }
  finally { w.f.ripristina(); }
});

test('production: nuova email -> risposta neutra, email inviata con descrizione escapata', async () => {
  const w = mondoFinto();
  try {
    const res = await chiama({ email: 'Mario@Example.com', description: '<b>hack</b>' }, { ip: '198.51.100.20' });
    assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true);
    assert.equal(w.mail.length, 1);
    assert.deepEqual(w.mail[0].to, ['mario@example.com']);
    assert.ok(!w.mail[0].html.includes('<b>hack</b>'));
  } finally { w.f.ripristina(); }
});

test('production: nessuna enumerazione — stessa risposta per email nuova, gia\' registrata e limitata', async () => {
  const w = mondoFinto();
  try {
    const nuova = await chiama({ email: 'x@example.com' }, { ip: '198.51.100.31' });
    // Seconda richiesta stessa email (limite per indirizzo) e terza con chiave esistente dopo reset limite
    const ripetuta = await chiama({ email: 'x@example.com' }, { ip: '198.51.100.32' });
    for (const k of [...w.kv.keys()]) if (k.includes('rl:reqkey:email:')) w.kv.delete(k);
    // Redis finto restituisce stringhe JSON per le get: simula la chiave gia' esistente
    const idx = [...w.kv.keys()].find(k => k.includes('apikeys:email:x@example.com'));
    assert.ok(idx, 'indice email creato');
    const esistente = await chiama({ email: 'x@example.com' }, { ip: '198.51.100.33' });
    assert.deepEqual(nuova.body, ripetuta.body);
    assert.deepEqual(nuova.body, esistente.body);
    assert.equal(nuova.statusCode, 200); assert.equal(ripetuta.statusCode, 200); assert.equal(esistente.statusCode, 200);
    assert.equal('resent' in esistente.body, false);
  } finally { w.f.ripristina(); }
});

test('production: limite per email — la seconda richiesta ravvicinata non invia altre email', async () => {
  const w = mondoFinto();
  try {
    await chiama({ email: 'lim@example.com' }, { ip: '198.51.100.41' });
    const prima = w.mail.length;
    await chiama({ email: 'lim@example.com' }, { ip: '198.51.100.42' });
    assert.equal(w.mail.length, prima);
  } finally { w.f.ripristina(); }
});

test('production: limite IP 3/ora con Retry-After', async () => {
  const w = mondoFinto();
  try {
    for (let i = 0; i < 3; i++) await chiama({ email: `u${i}@example.com` }, { ip: '198.51.100.50' });
    const res = await chiama({ email: 'u9@example.com' }, { ip: '198.51.100.50' });
    assert.equal(res.statusCode, 429); assert.equal(res.body.code, 'RATE_LIMITED'); assert.ok(res.headers['retry-after']);
  } finally { w.f.ripristina(); }
});

test('production: errore Redis/Resend -> 502 JSON generico (nessun crash 500 HTML)', async () => {
  const f = stubFetch(() => { throw new Error('rete giu'); });
  try { const res = await chiama({ email: 'e@example.com' }, { ip: '198.51.100.60' }); assert.equal(res.statusCode, 502); assert.equal(res.body.code, 'REQUESTKEY_FAILED'); }
  finally { f.ripristina(); }
});
