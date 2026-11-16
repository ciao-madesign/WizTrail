import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { validaUrl, hostBloccato, ipPrivato, risolviSicuro, scaricaSicuro, ErroreImport } from '../server/netguard.js';

const DA_BLOCCARE = [
  'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://0/', 'http://0.0.0.1/',
  'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.1/', 'http://192.168.1.1/', 'http://169.254.169.254/',
  'http://100.64.0.1/', 'http://198.18.0.1/', 'http://224.0.0.1/',
  'http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a00:1]/',
  'http://[fd00::1]/', 'http://[fc00::1]/', 'http://[fe80::1]/', 'http://[ff02::1]/',
  'http://localhost/', 'http://localhost./', 'http://LOCALHOST/', 'http://app.localhost/', 'http://stampante.local/',
  'http://metadata.google.internal/', 'http://intranet/', 'http://user:pw@example.com/', 'http://example.com:8080/',
  'ftp://example.com/x.gpx', 'file:///etc/passwd', 'javascript:alert(1)',
];
for (const u of DA_BLOCCARE) {
  test(`SSRF: blocca ${u}`, () => {
    assert.throws(() => validaUrl(u), (e) => e instanceof ErroreImport && e.status === 400);
  });
}

const DA_AMMETTERE = ['https://example.com/a.gpx', 'http://8.8.8.8/x.gpx', 'https://[2606:4700:4700::1111]/x', 'https://fdroid.org/', 'http://169.254.169.254.nip.io/'];
for (const u of DA_AMMETTERE) {
  test(`SSRF: ammette a livello di nome ${u} (nessun falso positivo)`, () => {
    assert.doesNotThrow(() => validaUrl(u));
  });
}

test('ipPrivato: pubblici ammessi, mapped valutati sulla parte v4', () => {
  assert.equal(ipPrivato('8.8.8.8'), false);
  assert.equal(ipPrivato('2606:4700:4700::1111'), false);
  assert.equal(ipPrivato('::ffff:8.8.8.8'), false);
  assert.equal(ipPrivato('::ffff:10.0.0.1'), true);
  assert.equal(ipPrivato('non-un-ip'), true);
});

test('hostBloccato: nome pubblico ammesso', () => {
  assert.equal(hostBloccato('www.wikiloc.com'), null);
});

test('DNS rebinding: nome che risolve a IP privato e\' bloccato', async () => {
  const lookup = async () => [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(() => risolviSicuro('evil.example.com', lookup), (e) => e.code === 'BLOCKED_HOST');
});

test('DNS: basta un solo indirizzo privato tra quelli risolti', async () => {
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }];
  await assert.rejects(() => risolviSicuro('evil.example.com', lookup), (e) => e.code === 'BLOCKED_HOST');
});

test('DNS non risolvibile: errore italiano UPSTREAM_UNREACHABLE', async () => {
  const lookup = async () => { throw new Error('ENOTFOUND'); };
  await assert.rejects(() => risolviSicuro('nessuno.example.com', lookup), (e) => e.code === 'UPSTREAM_UNREACHABLE' && /Impossibile/.test(e.message));
});

/* ── Redirect: finto modulo http che risponde con 302 verso un host privato ── */
function implFinta(sequenza) {
  let i = 0;
  return {
    request(u, opts, cb) {
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => process.nextTick(() => {
        const r = sequenza[Math.min(i++, sequenza.length - 1)];
        const res = new EventEmitter();
        res.statusCode = r.status; res.headers = r.headers || {}; res.resume = () => {}; res.destroy = () => {};
        cb(res);
        if (r.body !== undefined) process.nextTick(() => { res.emit('data', Buffer.from(r.body)); res.emit('end'); });
      });
      return req;
    },
  };
}
const lookupPubblico = async () => [{ address: '93.184.216.34', family: 4 }];

test('redirect verso host privato: bloccato alla rivalidazione', async () => {
  const impl = implFinta([{ status: 302, headers: { location: 'http://127.0.0.1/segreto' } }]);
  await assert.rejects(() => scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico }), (e) => e.code === 'BLOCKED_HOST');
});

test('redirect verso IPv6 locale con parentesi: bloccato', async () => {
  const impl = implFinta([{ status: 301, headers: { location: 'http://[::1]/x' } }]);
  await assert.rejects(() => scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico }), (e) => e.code === 'BLOCKED_HOST');
});

test('redirect: massimo 3 passaggi', async () => {
  const impl = implFinta([{ status: 302, headers: { location: 'https://pubblico.example.com/b' } }]);
  await assert.rejects(() => scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico }), (e) => e.code === 'TOO_MANY_REDIRECTS');
});

test('redirect lecito seguito fino al file', async () => {
  const impl = implFinta([
    { status: 302, headers: { location: '/gpx/vero.gpx' } },
    { status: 200, headers: { 'content-type': 'application/gpx+xml' }, body: '<gpx></gpx>' },
  ]);
  const r = await scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico });
  assert.equal(r.buffer.toString(), '<gpx></gpx>');
  assert.equal(r.finalUrl, 'https://pubblico.example.com/gpx/vero.gpx');
});

test('pagina HTML: errore HTML_PAGE con testo contestuale', async () => {
  const impl = implFinta([{ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }]);
  await assert.rejects(() => scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico }),
    (e) => e.code === 'HTML_PAGE' && e.status === 422 && /pagina web/.test(e.message));
});

test('content-length oltre il tetto: TOO_LARGE prima di scaricare', async () => {
  const impl = implFinta([{ status: 200, headers: { 'content-type': 'application/xml', 'content-length': '99999999' } }]);
  await assert.rejects(() => scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico, maxBytes: 1000 }), (e) => e.code === 'TOO_LARGE' && e.status === 413);
});

test('corpo oltre il tetto in streaming (senza content-length): TOO_LARGE', async () => {
  const impl = implFinta([{ status: 200, headers: { 'content-type': 'application/xml' }, body: 'x'.repeat(5000) }]);
  await assert.rejects(() => scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico, maxBytes: 1000 }), (e) => e.code === 'TOO_LARGE');
});

test('upstream 404: UPSTREAM_ERROR 502 con codice nel testo', async () => {
  const impl = implFinta([{ status: 404, headers: {} }]);
  await assert.rejects(() => scaricaSicuro('https://pubblico.example.com/a', { impl, lookup: lookupPubblico }), (e) => e.code === 'UPSTREAM_ERROR' && /404/.test(e.message));
});

/* ── Server HTTP locale reale (consentiPrivati solo nei test) ── */
function avviaServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('server reale: scarica GPX, rispetta timeout (UPSTREAM_TIMEOUT)', async () => {
  const s = await avviaServer((req, res) => { /* non risponde mai */ });
  const porta = s.address().port;
  try {
    await assert.rejects(() => scaricaSicuro(`http://127.0.0.1:${porta}/lento`, { consentiPrivati: true, timeoutMs: 300 }), (e) => e.code === 'UPSTREAM_TIMEOUT' && e.status === 504);
  } finally { s.closeAllConnections?.(); s.close(); }
});

test('server reale: download GPX completo', async () => {
  const s = await avviaServer((req, res) => { res.writeHead(200, { 'content-type': 'application/gpx+xml' }); res.end('<gpx><trk/></gpx>'); });
  const porta = s.address().port;
  try {
    const r = await scaricaSicuro(`http://127.0.0.1:${porta}/a.gpx`, { consentiPrivati: true });
    assert.match(r.buffer.toString(), /<gpx>/);
  } finally { s.close(); }
});

test('server reale: corpo infinito interrotto dal tetto di byte', async () => {
  const s = await avviaServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml' });
    const t = setInterval(() => res.write('x'.repeat(4096)), 5);
    res.on('close', () => clearInterval(t));
  });
  const porta = s.address().port;
  try {
    await assert.rejects(() => scaricaSicuro(`http://127.0.0.1:${porta}/inf`, { consentiPrivati: true, maxBytes: 20000, timeoutMs: 3000 }), (e) => e.code === 'TOO_LARGE');
  } finally { s.closeAllConnections?.(); s.close(); }
});
