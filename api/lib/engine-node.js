/**
 * engine-node.js — WizTrail Engine v5.1 per Node.js
 * Port di wiztrail-engine.js: stessa matematica, nessuna dipendenza DOM.
 *
 * IMPORTANTE: tenere sincronizzato con wiztrail-engine.js.
 * Se cambiano soglie, kT, EXP o formule, aggiornare entrambi i file.
 */

const kT = 0.50;

/* WDI_NORM_CATEGORIES v5 — ricalibrate 10/06/2026:
   v4 aveva wdiMax troppo basso (Short=50) → 5 gare al 10/10 nel ranking.
   v5 alza i massimi al 95° percentile osservato e introduce curva power (NORM_GAMMA).
   Sincronizzato con wiztrail-engine.js. */
const WDI_NORM_CATEGORIES = [
  { distMax:  25, wdiMin: 10, wdiMax:  80, label: 'Short'  },
  { distMax:  50, wdiMin: 15, wdiMax: 100, label: 'Medium' },
  { distMax:  95, wdiMin: 30, wdiMax: 160, label: 'Long'   },
  { distMax: Infinity, wdiMin: 80, wdiMax: 300, label: 'Ultra' },
];

/* Gamma per curva power nella normalizzazione WDI (v5 — 10/06/2026).
   γ < 1 → curva sub-lineare: alza i valori bassi, quasi invariata per gli alti.
   Sincronizzato con wiztrail-engine.js. */
const NORM_GAMMA = 0.65;

const WDI_THRESHOLDS = [
  { max:  22,      level: 'Sport',    color: '#2BB7DA' },
  { max:  40,      level: 'Pro',      color: '#34A853' },
  { max:  70,      level: 'Advanced', color: '#F4C20D' },
  { max: 120,      level: 'Extreme',  color: '#F79617' },
  { max: 200,      level: 'Elite',    color: '#E91E63' },
  { max: Infinity, level: 'Legend',   color: '#8E24AA' },
];

const TECH_THRESHOLDS = [
  { max: 25,       level: 'Facile',        color: '#2BB7DA' },
  { max: 40,       level: 'Scorrevole',    color: '#34A853' },
  { max: 55,       level: 'Moderato',      color: '#F4C20D' },
  { max: 70,       level: 'Tecnico',       color: '#F79617' },
  { max: 85,       level: 'Molto tecnico', color: '#E91E63' },
  { max: 95,       level: 'Alpinistico',   color: '#8E24AA' },
  { max: Infinity, level: 'Estremo',       color: '#FF0080' },
];

const SURFACE_MULT = { 1: 0.92, 2: 0.97, 3: 1.00, 4: 1.04, 5: 1.08 };

/* TERRAIN_DEFAULTS v3 — ricalibrati 10/06/2026 (vedi wiztrail-engine.js per dettagli) */
const TERRAIN_DEFAULTS = {
  'E':  { frip: 0.25, slopeVar: 0.08, roughness: 0.10 },
  'EE': { frip: 0.48, slopeVar: 0.13, roughness: 0.20 },
  'EA': { frip: 0.72, slopeVar: 0.17, roughness: 0.32 },
};

const DISCIPLINE_BADGES = {
  trail:    { label: 'Trail',    color: '#2d9e6a', emoji: '🌲' },
  sky:      { label: 'Sky',      color: '#e05c5c', emoji: '⛰️'  },
  mountain: { label: 'Mountain', color: '#6b9ec8', emoji: '🏔️'  },
  ultra:    { label: 'Ultra',    color: '#8E24AA', emoji: '🔥'  },
  xc:       { label: 'XC',       color: '#e9a800', emoji: '🏅'  },
};

/* ── Private helpers ──────────────────────────────────────────────── */

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function classifyBy(value, thresholds) {
  for (const t of thresholds) {
    if (value < t.max) return { level: t.level, color: t.color };
  }
  return thresholds[thresholds.length - 1];
}

function computeSlopes(d, e) {
  const slopes = [];
  for (let i = 1; i < d.length; i++) {
    const dd = d[i] - d[i - 1];
    if (dd > 0) slopes.push((e[i] - e[i - 1]) / dd);
  }
  return slopes;
}

function computeFRIP(d, e) {
  let maxSlope = 0;
  for (let i = 0; i < d.length; i++) {
    let j = i;
    while (j < d.length && d[j] < d[i] + 40) j++;
    if (j >= d.length) break;
    const slope = Math.abs((e[j] - e[i]) / Math.max(1, d[j] - d[i]));
    if (slope > maxSlope) maxSlope = slope;
  }
  return maxSlope;
}

function computeSlopeVar(slopes) {
  if (!slopes.length) return 0;
  const abs  = slopes.map(Math.abs);
  const mean = abs.reduce((s, v) => s + v, 0) / abs.length;
  const variance = slopes.reduce((s, v) => s + (v - mean) ** 2, 0) / slopes.length;
  return Math.sqrt(variance) / (1 + mean);
}

function computeRoughness(slopes) {
  if (slopes.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < slopes.length; i++) sum += Math.abs(slopes[i] - slopes[i - 1]);
  return sum / slopes.length;
}

function computeLoss(e) {
  let loss = 0;
  for (let i = 1; i < e.length; i++) if (e[i] < e[i - 1]) loss += e[i - 1] - e[i];
  return loss;
}

function computeAltMedia(e) {
  return e && e.length ? e.reduce((s, v) => s + v, 0) / e.length : 0;
}

function buildTechScore(frip, slopeVar, roughness, gain, km, surfaceLevel) {
  const normFRIP  = clamp(frip      / 0.924, 0, 1);
  const normSVar  = clamp(slopeVar  / 0.180, 0, 1);
  const normRough = clamp(roughness / 0.500, 0, 1);
  const vertInt   = clamp((gain / km) / 74.1, 0, 1);
  const raw = (normFRIP * 0.244 + normSVar * 0.421 + normRough * 0.208) * 0.873
            + vertInt * 0.127;
  const mult = SURFACE_MULT[surfaceLevel] || 1.00;
  return Math.round(raw * 100 * mult * 10) / 10;
}

function buildVolumeScore(gain, loss) {
  const Dkm  = gain / 1000;
  const Dlkm = loss / 1000;
  return (Dkm  * 10) / (1 + Math.sqrt(Dkm)  / 8)
       + (Dlkm *  4) / (1 + Math.sqrt(Dlkm)  / 6);
}

function buildDistFactor(km) {
  const EXP = 0.48;
  const REF = Math.pow(42, EXP);
  if (km <= 100) return Math.pow(km, EXP) / REF;
  const base100 = Math.pow(100, EXP) / REF;
  const ref100  = Math.pow(100, 0.42);
  return base100 + (Math.pow(km, 0.42) - ref100) / REF * 0.6;
}

function buildAltFactor(altMedia) {
  return 1 + clamp((altMedia - 1300) / 10000, 0, 0.15);
}

function normalizeWDI(wdi, km) {
  let cat = WDI_NORM_CATEGORIES[WDI_NORM_CATEGORIES.length - 1];
  for (const c of WDI_NORM_CATEGORIES) {
    if (km <= c.distMax) { cat = c; break; }
  }
  const x    = clamp((wdi - cat.wdiMin) / (cat.wdiMax - cat.wdiMin), 0, 1);
  const norm = Math.pow(x, NORM_GAMMA) * 10;
  const isLegendPlus = (cat.label === 'Ultra' && wdi > cat.wdiMax);
  return {
    norm:          Math.round(clamp(norm, 0, 10) * 10) / 10,
    category:      cat.label,
    isLegendPlus,
  };
}

function assemble(techScore, volumeScore, distFactor, altFactor,
                  frip, slopeVar, roughness, gain, loss, km,
                  surfaceLevel, estimatedTech, osmResult) {
  let finalTech = techScore;
  if (osmResult && osmResult.confidence > 0) {
    const w = 0.20 * osmResult.confidence;
    finalTech = Math.round((techScore * (1 - w) + osmResult.score * w) * 10) / 10;
  }

  const wdi  = Math.round((volumeScore + finalTech * kT) * distFactor * altFactor * 10) / 10;
  const wi   = classifyBy(wdi, WDI_THRESHOLDS);
  const ti   = classifyBy(finalTech, TECH_THRESHOLDS);
  const normResult = normalizeWDI(wdi, km);

  return {
    WDI:             wdi,
    WDI_norm:        normResult.norm,
    WDI_category:    normResult.category,
    WDI_legendPlus:  normResult.isLegendPlus,
    class:           wi.level,
    color:           wi.color,
    TechScore:       finalTech,
    techClass:       ti.level,
    techColor:       ti.color,
    factors: {
      km, gain, loss,
      VolumeScore:   Math.round(volumeScore * 10) / 10,
      DistFactor:    Math.round(distFactor  * 100) / 100,
      AltFactor:     Math.round(altFactor   * 100) / 100,
      FRIP:          Math.round(frip        * 1000) / 1000,
      SlopeVar:      Math.round(slopeVar    * 1000) / 1000,
      Roughness:     Math.round(roughness   * 1000) / 1000,
      surfaceLevel,
    },
    estimatedTech,
  };
}

/* ── Public API ───────────────────────────────────────────────────── */

export function computeFromGpx(metrics, surfaceLevel = 3, osmResult = null) {
  const { d, e, km, gain } = metrics;
  const loss     = metrics.loss     !== undefined ? metrics.loss     : computeLoss(e);
  const altMedia = metrics.altMedia !== undefined ? metrics.altMedia : computeAltMedia(e);

  // Usa eSmooth se disponibile — sincronizzato con wiztrail-engine.js
  const eForTech  = metrics.eSmooth || e;
  const slopes    = computeSlopes(d, eForTech);
  const frip      = computeFRIP(d, eForTech);
  const slopeVar  = computeSlopeVar(slopes);
  const roughness = computeRoughness(slopes);

  const techScore   = buildTechScore(frip, slopeVar, roughness, gain, km, surfaceLevel);
  const volumeScore = buildVolumeScore(gain, loss);
  const distFactor  = buildDistFactor(km);
  const altFactor   = buildAltFactor(altMedia);

  return assemble(techScore, volumeScore, distFactor, altFactor,
                  frip, slopeVar, roughness, gain, loss, km,
                  surfaceLevel, false, osmResult);
}

export function computeManual(opts) {
  const km         = opts.km;
  const gain       = opts.gain;
  let   loss       = opts.loss || opts.gain;
  const terrainCat = opts.terrainCat   || 'EE';
  const surfaceLevel = opts.surfaceLevel || 3;
  const altMedia   = opts.altMedia     || 800;
  const def = TERRAIN_DEFAULTS[terrainCat] || TERRAIN_DEFAULTS['EE'];

  const techScore   = buildTechScore(def.frip, def.slopeVar, def.roughness, gain, km, surfaceLevel);
  const volumeScore = buildVolumeScore(gain, loss);
  const distFactor  = buildDistFactor(km);
  const altFactor   = buildAltFactor(altMedia);

  return assemble(techScore, volumeScore, distFactor, altFactor,
                  def.frip, def.slopeVar, def.roughness, gain, loss, km,
                  surfaceLevel, true, null);
}

export function classifyDiscipline({ distance_km, dplus, max_altitude = 0 }) {
  const km  = distance_km || 0;
  if (km === 0) return 'trail';
  const avg_gain_per_km = dplus / km;
  if (km >= 95) return 'ultra';
  if (
    (max_altitude > 2900 && avg_gain_per_km > 70) ||
    (max_altitude > 2200 && avg_gain_per_km > 84) ||
    (max_altitude > 2000 && avg_gain_per_km > 100)
  ) return 'sky';
  if (avg_gain_per_km > 80 && max_altitude > 1200) return 'mountain';
  if (km <= 12 && dplus < 200) return 'xc';
  return 'trail';
}

export function getClass(wdi) { return classifyBy(wdi, WDI_THRESHOLDS).level; }
export function getColor(wdi) { return classifyBy(wdi, WDI_THRESHOLDS).color; }
export { DISCIPLINE_BADGES, WDI_THRESHOLDS, TECH_THRESHOLDS };
