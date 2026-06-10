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

/* KF_TERRAIN_PARAMS — Fase 12. Sincronizzato con wiztrail-timing.js. */
const KF_TERRAIN_PARAMS = {
  wdi_scale:          500,
  specificity_weight: 0.4,
};

export function terrainFactor(wdi, S) {
  return 1 + (wdi / KF_TERRAIN_PARAMS.wdi_scale) * (1 - S * KF_TERRAIN_PARAMS.specificity_weight);
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

export { VELOCITY_PARAMS, TRAIL_BASE_FACTOR, KF_TERRAIN_PARAMS };
