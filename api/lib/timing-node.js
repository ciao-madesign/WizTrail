/**
 * timing-node.js — WizTrail Timing per Node.js
 * Port di wiztrail-timing.js: stessa matematica, nessuna dipendenza DOM.
 *
 * IMPORTANTE: tenere sincronizzato con wiztrail-timing.js.
 */

import { smoothElevation, computeSegments } from './gpx-node.js';

const VELOCITY_PARAMS = {
  k_base:        1.5,
  k_spread:      2.5,
  cap_base:      1.6,
  cap_spread:    0.9,
  boost_base:    1.05,
  boost_S:       0.25,
  fatigue_coeff: 0.6,
};

const TRAIL_BASE_FACTOR = { 'Strada': 1.00, 'E': 1.00, 'EE': 0.85, 'EA': 0.75 };

/* KF_TERRAIN_PARAMS — Fase 12. Sincronizzato con wiztrail-timing.js.
   Usa TechScore (non WDI): WDI include distanza/dislivello già nel timing engine. */
const KF_TERRAIN_PARAMS = {
  tech_scale:         400,
  specificity_weight: 0.4,
};

export function terrainFactor(techScore, S) {
  return 1 + (techScore / KF_TERRAIN_PARAMS.tech_scale) * (1 - S * KF_TERRAIN_PARAMS.specificity_weight);
}

function velocityFromSlope(p, S, velBase) {
  const vp = VELOCITY_PARAMS;
  if (Math.abs(p) < 0.015) return velBase;
  if (p > 0) {
    const k   = vp.k_base + vp.k_spread * (1 - S);
    const cap = vp.cap_base + vp.cap_spread * (1 - S);
    return velBase / Math.min(1 + k * p, cap);
  }
  const boost = vp.boost_base + vp.boost_S * S;
  if (p < -0.25) {
    const steep = (1 - S) * (Math.abs(p) - 0.25) * 2;
    return velBase * Math.max(boost - steep, 0.85);
  }
  return velBase * boost;
}

function technicalPenalty(slope, terrainClass) {
  if (terrainClass === 'E')   return 0;
  if (terrainClass === 'EE' && (slope > 0.08 || slope < -0.10)) return 0.12;
  if (terrainClass === 'EA' && (slope > 0.08 || slope < -0.10)) return 0.28;
  return 0;
}

function fatigueFactor(t_hours) {
  return 1 + VELOCITY_PARAMS.fatigue_coeff * Math.pow(t_hours / 8, 1.2);
}

/**
 * @param {[number,number,number][]} pts  — track points [lat,lon,ele]
 * @param {{ km, gain, e, d }} metrics    — from gpx-node.compute()
 * @param {number} velBase               — km/h base velocity on flat road
 * @param {number} S                     — specificity [0=beginner, 1=elite]
 * @param {string} terrainClass          — 'Strada'|'E'|'EE'|'EA'
 * @param {number} meteo                 — weather factor (default 1)
 * @param {number} alt                   — altitude factor (default 1)
 * @param {number} manualGain            — D+ override if GPX has no elevation
 * @returns {number} time in seconds
 */
export function computeTime(pts, metrics, velBase, S, terrainClass, meteo = 1, alt = 1, manualGain = 0) {
  if (!pts || pts.length < 2) return 0;
  terrainClass = terrainClass || 'E';

  const velBaseEff = velBase * (TRAIL_BASE_FACTOR[terrainClass] ?? 0.90);
  const elev_s     = smoothElevation(metrics.e);
  const segments   = computeSegments(pts, metrics.d, elev_s);

  let T = 0;
  for (const seg of segments) {
    const velLocal = velocityFromSlope(seg.slope, S, velBaseEff);
    const tech     = technicalPenalty(seg.slope, terrainClass);
    const velTech  = velLocal / (1 + tech);
    const t_raw    = seg.dist / (velTech * 1000 / 3600);
    const fat      = fatigueFactor(T / 3600);
    T += t_raw * fat;
  }

  if (metrics.gain === 0 && manualGain > 0) {
    T += (manualGain / 8) * 60;
  }

  const T_hours = T / 3600;
  T *= 1 + (meteo - 1) * (T_hours / 5);
  T *= alt;

  return T;
}

export function levelFromS(S) {
  if (S >= 0.9) return 'Élite';
  if (S >= 0.7) return 'Agonista';
  if (S >= 0.5) return 'Amatore forte';
  if (S >= 0.3) return 'Amatore avanzato';
  if (S >= 0.1) return 'Amatore';
  return 'Principiante';
}

/* Modello mediana — calibrato su 32.402 gare UTMB (Kaggle, Maarten Poirot)
   T_median_h = a × km^b × (D+/1000)^c × exp(d × alt_km) */
export const MEDIAN_MODEL = {
  short:  { a: 0.370641, b: 0.6944, c: 0.3586, d: 0.0552 },
  medium: { a: 0.321490, b: 0.7445, c: 0.3466, d: 0.0587 },
  long:   { a: 0.305509, b: 0.7651, c: 0.3555, d: 0.0433 },
  ultra:  { a: 0.249561, b: 0.8286, c: 0.3501, d: 0.0256 },
};

export const PERCENTILE_SIGMA = { short: 0.203, medium: 0.181, long: 0.166, ultra: 0.167 };

function _distCat(km) {
  if (km <= 25) return 'short';
  if (km <= 50) return 'medium';
  if (km <= 95) return 'long';
  return 'ultra';
}

function normCDF(z) {
  const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (b[0] + t * (b[1] + t * (b[2] + t * (b[3] + t * b[4]))));
  const cdf = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

export function estimateMedianTime(km, dplus, altM) {
  if (!km || km <= 0 || !dplus || dplus <= 0) return null;
  const m = MEDIAN_MODEL[_distCat(km)];
  const altKm = (altM || 0) / 1000;
  return m.a * Math.pow(km, m.b) * Math.pow(dplus / 1000, m.c) * Math.exp(m.d * altKm) * 3600;
}

export function estimatePercentile(T_personal_sec, T_median_sec, km) {
  if (!T_personal_sec || !T_median_sec || T_personal_sec <= 0 || T_median_sec <= 0) return null;
  const sigma = PERCENTILE_SIGMA[_distCat(km)];
  const z = (Math.log(T_personal_sec) - Math.log(T_median_sec)) / sigma;
  return (1 - normCDF(z)) * 100;
}

export { VELOCITY_PARAMS, TRAIL_BASE_FACTOR, KF_TERRAIN_PARAMS };
