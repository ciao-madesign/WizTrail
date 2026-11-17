// Parita' frontend <-> port server (server/*-node.js): engine, parser GPX, timing.
// Il frontend (IIFE su window) viene caricato in un contesto vm con xmldom come DOMParser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console, Math, Date, JSON, Number, Object, Array, Infinity, isFinite, isNaN, parseFloat, parseInt, String, DOMParser };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['wiztrail-engine.js', 'gpx-parser.js', 'wiztrail-timing.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WizTrail, GP = ctx.GPXParser, TM = ctx.WizTrailTiming;
const eng = await import('../server/engine-node.js');
const gn = await import('../server/gpx-node.js');
const tn = await import('../server/timing-node.js');

const TOLLERANZA = 0.005; // 0,5%
const diff = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(a));

test('engine: computeManual identico su 432 combinazioni (km, D+, terreno, fondo)', () => {
  let n = 0; const errori = [];
  for (const km of [5, 12, 25, 42, 80, 100, 170, 330])
    for (const g of [0, 300, 1500, 3000, 10000, 25000])
      for (const tc of ['E', 'EE', 'EA'])
        for (const sl of [1, 3, 5]) {
          const c = { km, gain: g, loss: g, terrainCat: tc, surfaceLevel: sl, altMedia: 900 };
          const a = WT.computeManual(c), b = eng.computeManual(c); n++;
          for (const k of ['WDI', 'WDI_norm', 'WDI_category', 'class', 'color', 'TechScore', 'techClass', 'estimatedTech']) {
            if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) errori.push(`${JSON.stringify(c)} ${k}: ${a[k]} vs ${b[k]}`);
          }
        }
  assert.equal(n, 432);
  assert.deepEqual(errori.slice(0, 5), [], `${errori.length} differenze`);
});

test('costanti allineate: soglie WDI, KF_terrain, velocita\', mediana', () => {
  const J = (o) => JSON.stringify(o); // oggetti del contesto vm hanno prototipi diversi: confronto per valore
  for (const lvl of [10, 22, 39, 40, 69, 70, 119, 120, 199, 200, 350]) {
    assert.equal(WT.getClass(lvl), eng.getClass(lvl), `classe WDI ${lvl}`);
    assert.equal(WT.getColor(lvl), eng.getColor(lvl), `colore WDI ${lvl}`);
  }
  assert.equal(J(TM.KF_TERRAIN_PARAMS), J(tn.KF_TERRAIN_PARAMS), 'KF_TERRAIN_PARAMS');
  assert.equal(J(TM.VELOCITY_PARAMS), J(tn.VELOCITY_PARAMS), 'VELOCITY_PARAMS');
  assert.equal(J(TM.MEDIAN_MODEL), J(tn.MEDIAN_MODEL), 'MEDIAN_MODEL');
  assert.equal(J(TM.PERCENTILE_SIGMA), J(tn.PERCENTILE_SIGMA), 'PERCENTILE_SIGMA');
  assert.equal(TM.terrainFactor(60, 0.5), tn.terrainFactor(60, 0.5));
  assert.equal(TM.levelFromS(0.6), tn.levelFromS(0.6));
});

test('timing: stima mediana e percentile identici', () => {
  for (const [km, g, alt] of [[10, 300, 900], [42, 2500, 900], [100, 6000, 1500], [170, 10000, 2000]]) {
    assert.equal(TM.estimateMedianTime(km, g, alt), tn.estimateMedianTime(km, g, alt));
    const med = tn.estimateMedianTime(km, g, alt);
    assert.equal(TM.estimatePercentile(med * 1.1, med, km), tn.estimatePercentile(med * 1.1, med, km));
  }
});

const DIR_GPX = path.join(ROOT, 'wiztrail-calibration', 'gpx');
const FILE_GPX = fs.existsSync(DIR_GPX) ? fs.readdirSync(DIR_GPX).filter(f => /\.gpx$/i.test(f)).sort().slice(0, 40) : [];

test('set di riferimento GPX presente (almeno 20 tracce)', () => {
  assert.ok(FILE_GPX.length >= 20, `trovati ${FILE_GPX.length} GPX in ${DIR_GPX}`);
});

test(`GPX reali: punti, distanza, D+, WDI, TechScore e tempo entro ${TOLLERANZA * 100}% (frontend vs server)`, () => {
  const problemi = [];
  for (const f of FILE_GPX) {
    const xml = fs.readFileSync(path.join(DIR_GPX, f), 'utf8');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const pa = GP.parseTrack(doc), ma = GP.compute(pa), ra = WT.computeFromGpx(pa, ma, 3, null);
    const pb = gn.parseTrack(xml), mb = gn.compute(pb), rb = eng.computeFromGpx(mb, 3, null);
    const ta = TM.computeTime(pa, ma, 9, 0.5, 'EE', 1, 1, 0), tb = tn.computeTime(pb, mb, 9, 0.5, 'EE', 1, 1, 0);
    if (pa.length !== pb.length) problemi.push(`${f}: punti ${pa.length} vs ${pb.length}`);
    if (diff(ma.km, mb.km) > TOLLERANZA) problemi.push(`${f}: km ${ma.km} vs ${mb.km}`);
    if (diff(ma.gain, mb.gain) > TOLLERANZA) problemi.push(`${f}: D+ ${ma.gain} vs ${mb.gain}`);
    if (diff(ra.WDI, rb.WDI) > TOLLERANZA) problemi.push(`${f}: WDI ${ra.WDI} vs ${rb.WDI}`);
    if (diff(ra.TechScore, rb.TechScore) > TOLLERANZA) problemi.push(`${f}: TechScore ${ra.TechScore} vs ${rb.TechScore}`);
    if (diff(ta, tb) > TOLLERANZA) problemi.push(`${f}: tempo ${Math.round(ta)} vs ${Math.round(tb)}`);
  }
  assert.deepEqual(problemi, [], `${problemi.length} file in drift`);
});
