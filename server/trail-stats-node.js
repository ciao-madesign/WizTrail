/**
 * trail-stats-node.js — Port Node.js di trail-stats.js
 * Stesse formule, nessuna dipendenza DOM.
 * Dipende da: gpx-node.js (computeSegments, hav)
 *
 * IMPORTANTE: tenere sincronizzato con trail-stats.js.
 */

import { computeSegments, hav } from './gpx-node.js';

const SLOPE_FLAT = 0.02;

function climbThresholds(km) {
  return km < 50
    ? { minHorizM: 300, minGainM: 30 }
    : { minHorizM: 500, minGainM: 50 };
}

function computeAlt(pts, metrics) {
  const elev = metrics.e.filter(Number.isFinite);
  if (!elev.length) {
    return { alt_min: 0, alt_mean: 0, alt_max: 0, alt_start: 0, alt_end: 0 };
  }
  return {
    alt_min:   Math.round(Math.min(...elev)),
    alt_max:   Math.round(metrics.max_altitude || Math.max(...elev)),
    alt_mean:  Math.round(elev.reduce((a, b) => a + b, 0) / elev.length),
    alt_start: Number.isFinite(pts[0]?.[2])              ? Math.round(pts[0][2])              : Math.round(elev[0]),
    alt_end:   Number.isFinite(pts[pts.length - 1]?.[2]) ? Math.round(pts[pts.length - 1][2]) : Math.round(elev[elev.length - 1]),
  };
}

function computeSlopes(pts, metrics) {
  const segs = computeSegments(pts, metrics.d, metrics.e, 80);
  if (!segs.length) {
    return {
      slope_up_avg: 0, slope_up_max: 0,
      slope_down_avg: 0, slope_down_max: 0,
      pct_uphill: 0, pct_flat: 100, pct_downhill: 0,
    };
  }

  let upDistW = 0, upSum = 0, upMax = 0;
  let downDistW = 0, downSum = 0, downMax = 0;
  let flatDist = 0, totalDist = 0;

  for (const seg of segs) {
    const s = seg.slope;
    const d = seg.dist;
    totalDist += d;

    if (s > SLOPE_FLAT) {
      upDistW += d;
      upSum   += s * d;
      if (s > upMax) upMax = s;
    } else if (s < -SLOPE_FLAT) {
      downDistW += d;
      downSum   += Math.abs(s) * d;
      if (Math.abs(s) > downMax) downMax = Math.abs(s);
    } else {
      flatDist += d;
    }
  }

  const T = totalDist || 1;
  return {
    slope_up_avg:   upDistW   > 0 ? Math.round(upSum   / upDistW   * 1000) / 10 : 0,
    slope_up_max:   Math.round(upMax   * 1000) / 10,
    slope_down_avg: downDistW > 0 ? Math.round(downSum / downDistW * 1000) / 10 : 0,
    slope_down_max: Math.round(downMax * 1000) / 10,
    pct_uphill:   Math.round(upDistW   / T * 100),
    pct_flat:     Math.round(flatDist  / T * 100),
    pct_downhill: Math.round(downDistW / T * 100),
  };
}

function computeClimbs(pts, metrics) {
  const { minHorizM, minGainM } = climbThresholds(metrics.km);
  const segs = computeSegments(pts, metrics.d, metrics.e, 80);

  let climbs = 0, descents = 0;
  let bestClimbKm = 0, bestClimbGain = 0;
  let runDir = 0, runDist = 0, runGain = 0;

  function flushRun() {
    if (runDir === 1 && runDist >= minHorizM && runGain >= minGainM) {
      climbs++;
      if (runGain > bestClimbGain) {
        bestClimbGain = runGain;
        bestClimbKm   = runDist / 1000;
      }
    }
    if (runDir === -1 && runDist >= minHorizM && Math.abs(runGain) >= minGainM) {
      descents++;
    }
    runDir = 0; runDist = 0; runGain = 0;
  }

  for (const seg of segs) {
    const dir = seg.slope > SLOPE_FLAT ? 1 : (seg.slope < -SLOPE_FLAT ? -1 : 0);

    if (dir === 0) {
      if (seg.dist > 200) flushRun();
      else if (runDir !== 0) runDist += seg.dist;
    } else if (dir === runDir) {
      runDist += seg.dist;
      runGain += seg.dh;
    } else {
      flushRun();
      runDir  = dir;
      runDist = seg.dist;
      runGain = seg.dh;
    }
  }
  flushRun();

  return {
    climbs_count:       climbs,
    descents_count:     descents,
    longest_climb_km:   Math.round(bestClimbKm   * 10) / 10,
    longest_climb_gain: Math.round(bestClimbGain),
  };
}

function computeEfficiency(pts, km) {
  if (!pts || pts.length < 2 || km <= 0) return 0;
  const last     = pts.length - 1;
  const straightM = hav(pts[0][0], pts[0][1], pts[last][0], pts[last][1]);
  return Math.round(straightM / (km * 1000) * 100) / 100;
}

export function compute(pts, metrics, engineResult) {
  if (!pts || pts.length < 2 || !metrics || !engineResult) return null;

  const f = engineResult.factors;

  return {
    ...computeAlt(pts, metrics),
    gain: Math.round(metrics.gain),
    loss: Math.round(f.loss || 0),
    ...computeSlopes(pts, metrics),
    ...computeClimbs(pts, metrics),
    trail_efficiency: computeEfficiency(pts, metrics.km),
    roughness:    f.Roughness,
    slope_var:    f.SlopeVar,
    frip:         f.FRIP,
    tech_density: metrics.km > 0
      ? Math.round(engineResult.TechScore / metrics.km * 10) / 10
      : 0,
  };
}
