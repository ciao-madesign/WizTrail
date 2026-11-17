// Test SEO statici: metadata unici, canonical, noindex, sitemap/robots coerenti, link interni, regole di vercel.json.
// Le regole di vercel.json sono verificate con una simulazione locale (RegExp sul "source"): non sostituisce la verifica su una preview Vercel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://wiz-trail.vercel.app';
const leggi = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const vercel = JSON.parse(leggi('vercel.json'));

const INDICIZZABILI = { 'landing.html': '/landing.html', 'index.html': '/index.html', 'about.html': '/about.html', 'compatibilita.html': '/compatibilita.html', 'training-analyzer.html': '/training-analyzer.html' };
const NOINDEX = ['ranking.html', 'install.html', 'privacy.html', 'dettaglio.html', 'share_card.html', 'trail-card.html', 'hub.html', 'import_strava.html', 'auth_strava.html'];
const TUTTE = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && f !== 'google836f8dbd20d85c05.html');

const head = (f) => leggi(f).match(/<head[^>]*>[\s\S]*?<\/head>/)[0];
const meta = (h, re) => (h.match(re) || [])[1];
const titolo = (f) => meta(head(f), /<title>([\s\S]*?)<\/title>/);
const descr = (f) => meta(head(f), /<meta name="description" content="([^"]*)"/);
const robots = (f) => meta(head(f), /<meta name="robots" content="([^"]*)"/);
const canonical = (f) => meta(head(f), /<link rel="canonical" href="([^"]*)"/);

// Simulazione minimale delle regole di vercel.json
const re = (s) => new RegExp('^' + s + '$');
const headersPer = (p) => Object.fromEntries((vercel.headers || []).filter(h => re(h.source).test(p)).flatMap(h => h.headers.map(x => [x.key.toLowerCase(), x.value])));
const rewritePer = (p) => (vercel.rewrites || []).find(r => re(r.source).test(p))?.destination;
const redirectPer = (p) => (vercel.redirects || []).find(r => re(r.source).test(p));

test('vercel.json: "/" e un redirect temporaneo (307) verso /landing.html; nessun rewrite mascherato da file statici', () => {
  const r = vercel.redirects.find(x => x.source === '/');
  assert.deepEqual([r.destination, r.permanent], ['/landing.html', false]);
  assert.equal(redirectPer('/landing.html'), undefined, 'niente redirect da /landing.html (service worker)');
  assert.equal(redirectPer('/index.html'), undefined);
  assert.equal(redirectPer('/wdi.html')?.destination, '/about.html');
  assert.equal(redirectPer('/pacing.html')?.destination, '/about.html');
  // Su Vercel i file statici battono le rewrites: una rewrite su "/" non scatta mai se esiste index.html.
  for (const rw of vercel.rewrites || []) {
    const lit = rw.source === '/' ? 'index.html' : rw.source.replace(/^\//, '');
    assert.ok(!fs.existsSync(path.join(ROOT, lit)), `rewrite ${rw.source} mascherata dal file statico ${lit}`);
  }
  assert.ok(!('routes' in vercel), 'non mischiare routes legacy con redirects/headers');
});

test('vercel.json: X-Robots-Tag sulle pagine private, non su quelle indicizzabili', () => {
  for (const f of ['hub', 'dettaglio', 'share_card', 'trail-card', 'auth_strava', 'import_strava', 'privacy'])
    assert.equal(headersPer(`/${f}.html`)['x-robots-tag'], 'noindex, nofollow', f);
  for (const f of ['install', 'ranking'])
    assert.equal(headersPer(`/${f}.html`)['x-robots-tag'], 'noindex, follow', f);
  for (const p of ['/landing.html', '/index.html', '/about.html', '/training-analyzer.html', '/google836f8dbd20d85c05.html'])
    assert.equal(headersPer(p)['x-robots-tag'], undefined, p);
});

test('vercel.json: cache immutable solo per img, icons e font woff2; JS/CSS brevi; service worker mai lungo', () => {
  const lungo = /immutable/;
  for (const p of ['/img/hero-landing.jpg', '/icons/icon-192.png', '/fonts/outfit-400-normal-latin.woff2'])
    assert.match(headersPer(p)['cache-control'] || '', lungo, p);
  for (const p of ['/main.js', '/wiztrail.css', '/ui.js', '/cookie-notice.js']) {
    const cc = headersPer(p)['cache-control'] || '';
    assert.ok(cc && !lungo.test(cc), `${p}: ${cc}`);
    assert.match(cc, /max-age=(\d+)/); assert.ok(Number(cc.match(/max-age=(\d+)/)[1]) <= 3600, p);
  }
  for (const p of ['/service-worker.js', '/fonts/fonts.css', '/landing.html', '/sitemap.xml', '/ranking-data.json'])
    assert.ok(!lungo.test(headersPer(p)['cache-control'] || ''), p);
  assert.equal(headersPer('/service-worker.js')['cache-control'], undefined);
});

test('JSON-LD: gli @id/url del sito puntano alla home canonica /landing.html', () => {
  const ids = [];
  for (const f of TUTTE) for (const m of leggi(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) ids.push(...[...m[1].matchAll(/"(?:@id|url)":"([^"]+)"/g)].map(x => x[1]));
  assert.ok(ids.length > 0);
  assert.ok(!ids.includes(BASE + '/') && !ids.some(i => i.startsWith(BASE + '/#')), 'JSON-LD su / (redirect)');
  assert.ok(ids.includes(BASE + '/landing.html#website'));
});

test('ogni pagina indicizzabile ha canonical assoluto autoreferenziale, title e description unici', () => {
  const visti = { t: new Set(), d: new Set(), o: new Set() };
  for (const [f, url] of Object.entries(INDICIZZABILI)) {
    assert.equal(canonical(f), BASE + url, f);
    const t = titolo(f), d = descr(f);
    assert.ok(t && t.length <= 70, `${f} title: ${t}`);
    assert.ok(d && d.length >= 70 && d.length <= 170, `${f} description (${d && d.length})`);
    assert.ok(!visti.t.has(t) && !visti.d.has(d), `${f}: title/description duplicati`);
    visti.t.add(t); visti.d.add(d);
    assert.match(robots(f) || 'index', /^index/, f);
    const h = head(f);
    for (const k of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt'])
      assert.ok(h.includes(`property="${k}"`), `${f} manca ${k}`);
    for (const k of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'])
      assert.ok(h.includes(`name="${k}"`), `${f} manca ${k}`);
    assert.equal(meta(h, /property="og:url" content="([^"]*)"/), BASE + url, `${f} og:url`);
    assert.equal((leggi(f).match(/<h1[\s>]/g) || []).length, 1, `${f}: un solo H1`);
    const og = meta(h, /property="og:image" content="([^"]*)"/);
    assert.ok(visti.o.size >= 0 && og.startsWith(BASE + '/img/og/'), `${f} og:image su dominio vercel`);
    visti.o.add(og);
  }
});

test('nessun riferimento a github.io o a /icons/logo.png; immagini OG esistenti e 1200x630', () => {
  for (const f of TUTTE) {
    const s = leggi(f);
    assert.ok(!/github\.io/.test(s), `${f}: github.io`);
    assert.ok(!/icons\/logo\.png/.test(s), `${f}: /icons/logo.png (404)`);
  }
  for (const f of Object.keys(INDICIZZABILI).concat(['ranking.html', 'share_card.html'])) {
    const og = meta(head(f), /property="og:image" content="([^"]*)"/);
    const file = path.join(ROOT, og.replace(BASE + '/', ''));
    assert.ok(fs.existsSync(file), `${f}: ${og} non esiste`);
    const b = fs.readFileSync(file); let i = 2, w, h;
    while (i < b.length) { if (b[i] !== 0xFF) { i++; continue; } const m = b[i + 1]; const len = b.readUInt16BE(i + 2); if (m >= 0xC0 && m <= 0xC3) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; } i += 2 + len; }
    assert.deepEqual([w, h], [1200, 630], og);
    assert.ok(b.length < 250 * 1024, `${og} troppo pesante`);
  }
});

test('pagine private/di servizio: noindex nel meta; ranking noindex,follow; ranking senza JSON-LD', () => {
  for (const f of NOINDEX) assert.match(robots(f) || '', /noindex/, f);
  assert.match(robots('ranking.html'), /^noindex, follow$/);
  assert.ok(!/ld\+json/.test(leggi('ranking.html')), 'ranking: JSON-LD rimosso');
  assert.equal(leggi('google836f8dbd20d85c05.html'), 'google-site-verification: google836f8dbd20d85c05.html');
  const nf = leggi('404.html'); assert.match(nf, /<meta name="robots" content="noindex">/);
});

test('sitemap: solo URL canoniche indicizzabili, tutte esistenti; nessuna pagina noindex', () => {
  const xml = leggi('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs.sort(), Object.values(INDICIZZABILI).map(u => BASE + u).sort());
  for (const f of NOINDEX) assert.ok(!xml.includes('/' + f), `${f} in sitemap`);
  assert.ok(!locs.some(l => redirectPer(new URL(l).pathname)), 'URL in sitemap che redirige');
  assert.ok(!locs.includes(BASE + '/'), '/ redirige a /landing.html');
  for (const [f, u] of Object.entries(INDICIZZABILI)) assert.equal(canonical(f), BASE + u, `${f}: sitemap = canonical`);
  for (const m of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!/priority|changefreq/.test(xml));
});

test('robots.txt: sitemap dichiarata e nessun Disallow su pagine gia noindex, manifest o icone', () => {
  const r = leggi('robots.txt');
  assert.ok(r.includes(`Sitemap: ${BASE}/sitemap.xml`));
  const dis = [...r.matchAll(/^Disallow:\s*(\S+)/gm)].map(m => m[1]);
  for (const d of dis) {
    assert.ok(!NOINDEX.some(f => d.endsWith(f)), `Disallow+noindex: ${d}`);
    assert.ok(!/manifest|icons|img|fonts/.test(d), d);
  }
});

test('.vercelignore esclude i file interni dal deploy; i file restano nel repo', () => {
  const v = leggi('.vercelignore');
  for (const x of ['/CLAUDE.md', '/docs/', '/wiztrail-knowledge-base.md', '/wiztrail-calibration/', '/README.md']) assert.ok(v.includes(x), x);
  for (const f of ['CLAUDE.md', 'docs', 'wiztrail-knowledge-base.md', 'wiztrail-calibration', 'README.md']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.ok(!/ranking-data|^\/lib|^\/img|^\/api|^\/server/m.test(v), 'non escludere asset necessari');
});

test('link interni: ogni href locale punta a un file esistente (e ancora presente)', () => {
  const ids = (f) => new Set([...leggi(f).matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const errori = [];
  for (const f of TUTTE) {
    for (const m of leggi(f).matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
      const h = m[1];
      if (/^(https?:|mailto:|tel:|javascript:|#|data:)/.test(h) || h.includes('${') || h.includes("'")) continue;
      const [p0, anchor] = h.split('#'); const p = p0.split('?')[0].replace(/^\//, '');
      const file = p === '' ? 'landing.html' : p;
      if (!fs.existsSync(path.join(ROOT, file))) { errori.push(`${f} -> ${h}`); continue; }
      if (anchor && file.endsWith('.html') && !ids(file).has(anchor)) errori.push(`${f} -> ${h} (ancora mancante)`);
    }
  }
  assert.deepEqual(errori, []);
});

test('icone: favicon e apple-touch-icon esistono e sono collegati in ogni pagina (tranne hub)', () => {
  for (const f of ['favicon.ico', 'icons/apple-touch-icon.png', 'icons/icon-192.png']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  for (const f of TUTTE.filter(x => x !== 'hub.html')) {
    const h = head(f);
    assert.ok(h.includes('rel="icon" href="/favicon.ico"'), `${f}: favicon`);
    assert.ok(h.includes('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"'), `${f}: apple-touch-icon`);
  }
  assert.equal(JSON.parse(leggi('manifest.webmanifest')).start_url, '/index.html');
});

test('font: nessun @import bloccante in wiztrail.css; fonts.css collegato in ogni pagina che usa wiztrail.css', () => {
  assert.ok(!/@import/.test(leggi('wiztrail.css')));
  assert.match(leggi('fonts/fonts.css'), /font-display:\s*swap/);
  for (const f of TUTTE.filter(x => /wiztrail\.css/.test(head(x)))) {
    const h = head(f);
    assert.ok(h.includes('<link rel="stylesheet" href="/fonts/fonts.css">'), `${f}: fonts.css`);
    assert.ok(h.includes('rel="preload" href="/fonts/outfit-400-normal-latin.woff2" as="font"'), `${f}: preload font`);
  }
});

test('Strava non e presentato come funzione attiva in meta e JSON-LD', () => {
  for (const f of TUTTE) {
    const s = leggi(f);
    for (const m of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const j = JSON.parse(m[1]);
      const feat = JSON.stringify(j.featureList || (j['@graph'] || []).flatMap(x => x.featureList || []));
      assert.ok(!/strava|orolog|suunto|garmin/i.test(feat), `${f}: featureList cita integrazioni`);
    }
    const h = head(f);
    for (const mm of h.matchAll(/<meta (?:name|property)="(?:description|og:description|twitter:description)" content="([^"]*)"/g))
      assert.ok(!/importa(re|zione)? da strava|sincronizz/i.test(mm[1]) || /non (ancora )?(è )?disponibil/i.test(mm[1]), `${f}: ${mm[1]}`);
    if (f in INDICIZZABILI) assert.ok(!/href="import_strava\.html/.test(s) || /aria-disabled/.test(s), `${f}: link attivo a import_strava`);
  }
});

test('claim assoluti di privacy assenti da meta e JSON-LD', () => {
  for (const f of TUTTE) {
    const h = head(f);
    assert.ok(!/tutto in locale|nessun dato personale inviato|nessun server/i.test(h), f);
  }
});

test('la navigazione resta nell\'HTML statico (link interni presenti senza JS)', () => {
  for (const f of Object.keys(INDICIZZABILI)) {
    const nav = (leggi(f).match(/<(nav|header)[^>]*>[\s\S]*?<\/(nav|header)>/g) || []).join('');
    for (const dest of ['index.html', 'about.html', 'training-analyzer.html'])
      assert.ok(nav.includes(`href="${dest}"`), `${f}: nav senza ${dest}`);
  }
});

test('compatibilita.html: pagina di stato funzioni, un solo H1, linkata da about/landing/footer, nessun claim di funzioni non disponibili', () => {
  const s = leggi('compatibilita.html');
  assert.equal((s.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(/<h2[^>]*>\s*Funzioni attive/.test(s) && /<h2[^>]*>\s*Funzioni in beta/.test(s) && /<h2[^>]*>\s*Non ancora disponibili/.test(s));
  // Strava e orologi compaiono solo nella sezione "Non ancora disponibili" (o come file caricati a mano / link che non sono file)
  const prima = s.slice(0, s.indexOf('id="non-disponibili"'));
  const corpo = prima.slice(prima.indexOf('<body'));
  for (const m of corpo.matchAll(/[^<>]*\b(Strava|Garmin|Suunto|Coros|Polar|orologi?o?)\b[^<>]*/gi))
    assert.ok(/file|a mano|caricare|carichi|esportat|non sono file|non può essere inviato|Komoot/i.test(m[0]), `claim ambiguo fuori dalla sezione "non disponibili": ${m[0].trim()}`);
  assert.ok(/Strava \(collegamento e importazione\)<\/td><td>[^<]*Scarica il GPX/.test(s));
  assert.ok(!/(presto|prossimamente|in arrivo|entro|dal \d)/i.test(corpo.replace(/Esportazione/g, '')), 'nessuna promessa di date o di arrivo');
  for (const f of ['about.html', 'landing.html', 'index.html', 'training-analyzer.html', 'ranking.html', 'privacy.html'])
    assert.ok(leggi(f).includes('href="compatibilita.html"'), `${f}: link a compatibilita.html`);
  for (const f of ['index.html', 'compatibilita.html']) assert.equal((leggi(f).match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0].match(/<a /g) || []).length, 4, `${f}: la tab bar resta a 4 voci`);
});

test('copy veritiero sul ranking: niente "ufficiale", "certificato" o richieste di certificazione nelle pagine del sito', () => {
  for (const f of TUTTE) {
    const s = leggi(f);
    assert.ok(!/ranking\s+(ufficiale|certificato)|badge\s+ufficiale|certificare\s+questa\s+gara/i.test(s), `${f}: formulazione non veritiera sul ranking`);
  }
  assert.ok(!/openCertContact/.test(leggi('ranking.html')));
});
