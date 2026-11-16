// API v1: il tempo stimato deve includere la correzione terreno (KF_terrain) come il sito (main.js):
//   T_finale = T_segmenti × terrainFactor(TechScore, S)
// Parita' verificata contro il frontend (wiztrail-timing.js, wiztrail-engine.js) su GPX reali e casi manuali.
// Nessuna rete e nessun Redis reale: senza UPSTASH_* il rate limit e' fail-open, la chiave e' statica (API_KEYS).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { mockReq, mockRes } from './helpers.mjs';

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.API_KEYS = 'chiave-di-test';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console, Math, Date, JSON, Number, Object, Array, Infinity, isFinite, isNaN, parseFloat, parseInt, String, DOMParser };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['wiztrail-engine.js', 'gpx-parser.js', 'wiztrail-timing.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WizTrail, GP = ctx.GPXParser, TM = ctx.WizTrailTiming;
const tn = await import('../server/timing-node.js');
const { default: wdi } = await import('../api/v1/wdi.js');
const { default: analyze } = await import('../api/v1/analyze.js');

const TOL = 0.005; // 0,5%
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(a));

async function chiama(handler, body) {
  const res = mockRes();
  await handler(mockReq({ method: 'POST', headers: { 'x-api-key': 'chiave-di-test' }, body }), res);
  return res;
}

/* Tempo del sito in modalita' manuale (noGpx), main.js: Naismith adattato, poi meteo/alt, poi KF_terrain.
   velBase = 6 + 6S km/h e' la velocita' su strada che l'API ricava dalla specificita' (il sito la ricava dal T10k). */
function tempoSitoManuale({ km, gain, S, terrain, surface = 3, alt = 800 }) {
  const velBase = 6 + S * 6;
  const velBaseEff = velBase * (TM.TRAIL_BASE_FACTOR[terrain] ?? 0.90);
  const T = ((km + (gain / 100) * (1.2 - 0.2 * S)) / velBaseEff) * 3600;
  const rs = WT.computeManual({ km, gain, loss: gain, terrainCat: terrain, altMedia: alt, surfaceLevel: surface });
  return { T: T * TM.terrainFactor(rs.TechScore, S), kf: TM.terrainFactor(rs.TechScore, S), tech: rs.TechScore };
}

test('wdi: tempo manuale = tempo del sito con KF_terrain (24 casi, tolleranza 0,5%)', async () => {
  const errori = [];
  for (const km of [10, 25, 42, 100]) for (const gain of [300, 2500, 6000]) for (const S of [0.2, 0.9]) for (const terrain of ['E', 'EE', 'EA']) {
    if (km === 10 && gain === 6000) continue;
    const res = await chiama(wdi, { distance_km: km, dplus: gain, specificity: S, terrain_cat: terrain });
    assert.equal(res.statusCode, 200);
    const sito = tempoSitoManuale({ km, gain, S, terrain });
    if (rel(sito.T, res.body.time_estimate.seconds) > TOL) errori.push(`${km}km ${gain}m S${S} ${terrain}: sito ${Math.round(sito.T)} api ${res.body.time_estimate.seconds}`);
    assert.equal(res.body.terrain_factor, Math.round(sito.kf * 1000) / 1000);
    assert.ok(res.body.terrain_factor >= 1);
  }
  assert.deepEqual(errori, []);
});

test('wdi: terrain_factor e\' additivo e il tempo e\' maggiorato rispetto al solo modello base', async () => {
  const res = await chiama(wdi, { distance_km: 30, dplus: 2000, terrain_cat: 'EA', specificity: 0.5 });
  const base = tn.computeTimeManual(30, 2000, 0.5, 'EA');
  assert.ok(res.body.terrain_factor > 1);
  assert.ok(rel(base * res.body.terrain_factor, res.body.time_estimate.seconds) < 0.003); // terrain_factor e' arrotondato a 3 decimali
  // campi preesistenti ancora presenti
  for (const k of ['estimate', 'wdi', 'wdi_norm', 'wdi_category', 'class', 'tech_score', 'tech_class', 'discipline', 'level', 'median_comparison']) assert.ok(k in res.body, k);
});

const DIR = path.join(ROOT, 'wiztrail-calibration', 'gpx');
const GPX = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /\.gpx$/i.test(f)).sort().slice(0, 10) : [];

test('set GPX reali disponibile (>= 8 tracce)', () => assert.ok(GPX.length >= 8));

test('analyze: tempo = tempo del sito con KF_terrain su GPX reali (tolleranza 0,5%)', async () => {
  const errori = []; let n = 0;
  for (const f of GPX) {
    const xml = fs.readFileSync(path.join(DIR, f), 'utf8');
    const pts = GP.parseTrack(new DOMParser().parseFromString(xml, 'text/xml'));
    const m = GP.compute(pts);
    if (!(m.km >= 0.5)) continue;
    for (const [S, terrain] of [[0.2, 'EE'], [0.9, 'EA']]) {
      const vBase = 6 + S * 6;
      const rs = WT.computeFromGpx(pts, m, 3, null);
      const kf = TM.terrainFactor(rs.TechScore, S);
      const sito = TM.computeTime(pts, m, vBase, S, terrain, 1, 1, 0) * kf;
      const res = await chiama(analyze, { gpx_base64: Buffer.from(xml).toString('base64'), specificity: S, terrain_class: terrain });
      assert.equal(res.statusCode, 200, f);
      n++;
      if (rel(sito, res.body.time_estimate.seconds) > TOL) errori.push(`${f} S${S} ${terrain}: sito ${Math.round(sito)} api ${res.body.time_estimate.seconds}`);
      assert.equal(res.body.terrain_factor, Math.round(kf * 1000) / 1000, f);
    }
  }
  assert.ok(n >= 12, `confronti eseguiti: ${n}`);
  assert.deepEqual(errori, []);
});

test('analyze: il pacing usa il tempo con KF come tempo obiettivo predefinito', async () => {
  const f = GPX.find(x => /50k/i.test(x)) || GPX[0];
  const xml = fs.readFileSync(path.join(DIR, f), 'utf8');
  const res = await chiama(analyze, { gpx_base64: Buffer.from(xml).toString('base64'), specificity: 0.5, terrain_class: 'EE' });
  // ritmo medio del piano × distanza ≈ tempo stimato (il piano ripartisce proprio quel tempo)
  const daRitmo = res.body.avg_pace.sec_km * res.body.distance_km;
  assert.ok(rel(res.body.time_estimate.seconds, daRitmo) < 0.01, `${daRitmo} vs ${res.body.time_estimate.seconds}`);
});

test('analyze: senza GPX valido risponde 400 e non cambia lo schema d\'errore', async () => {
  const res = await chiama(analyze, {});
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error);
});
