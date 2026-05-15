/**
 * pacing-node.js — WizTrail Pacing per Node.js
 * Port della logica di calcolo puro da wiztrail-pacing.js.
 * Nessuna dipendenza DOM (Leaflet, canvas, document).
 *
 * IMPORTANTE: tenere sincronizzato con wiztrail-pacing.js.
 */

/* ── Utilities ────────────────────────────────────────────────────── */

function safeNum(v) { return Number.isFinite(v) ? v : 0; }

export function secToHMS(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

export function secToPaceStr(secPerKm) {
  const mm = Math.floor(secPerKm / 60);
  const ss = Math.round(secPerKm % 60);
  return `${mm}:${String(ss).padStart(2,'0')}/km`;
}

/* ── Segmentazione GPX ────────────────────────────────────────────── */

function buildSegments(gpxPts, metrics) {
  const segments = [];
  if (!gpxPts || gpxPts.length < 2) return segments;
  for (let i = 0; i < gpxPts.length - 1; i++) {
    const d1 = safeNum(metrics.d[i]);
    const d2 = safeNum(metrics.d[i + 1]);
    const dist = d2 - d1;
    if (dist <= 0) continue;
    segments.push({
      index: i,
      startDist_m: d1,
      endDist_m: d2,
      dist_m: dist,
      elev_diff: safeNum(metrics.e[i + 1]) - safeNum(metrics.e[i]),
    });
  }
  return segments;
}

/* ── Costo locale segmento ────────────────────────────────────────── */

function segmentCost(seg, params) {
  const dist  = seg.dist_m;
  const slope = (seg.elev_diff ?? 0) / Math.max(dist, 1);

  let slopeF = 1;
  if (slope > 0) {
    if (slope < 0.05)      slopeF = 1 + slope * 6;
    else if (slope < 0.12) slopeF = 1 + slope * 10;
    else                   slopeF = 1 + slope * 18;
  } else if (slope < 0) {
    if (slope > -0.08)      slopeF = 1 - Math.abs(slope) * 3.0;
    else if (slope > -0.15) slopeF = 1 - Math.abs(slope) * 2.5;
    else if (slope > -0.25) slopeF = 1 - Math.abs(slope) * 1.0;
    else                    slopeF = 1 + Math.abs(slope) * 1.0;
    slopeF = Math.max(slopeF, 0.55);
  }

  const terr = params.terrainClass || 'Strada';
  let techF = 1;
  if (terr === 'E') techF = 1.05;
  if (terr === 'EE' && (slope > 0.08 || slope < -0.12)) techF = 1.15;
  if (terr === 'EA' && (slope > 0.08 || slope < -0.12)) techF = 1.30;

  const meteo = params.meteo ?? 1;
  const alt   = params.alt   ?? 1;

  return dist * slopeF * techF * meteo * alt;
}

/* ── Chunk building ───────────────────────────────────────────────── */

function buildPacingChunks(segments, params, gran_km) {
  const chunks = [];
  let currentKm = gran_km;
  let startIdx = 0;

  for (let i = 0; i < segments.length; i++) {
    const endKm = segments[i].endDist_m / 1000;
    if (endKm >= currentKm || i === segments.length - 1) {
      const segs = segments.slice(startIdx, i + 1);
      let totalCost = 0;
      const localCosts = segs.map(s => {
        const c = segmentCost(s, params);
        totalCost += c;
        return c;
      });
      let dist_m = 0;
      segs.forEach(s => dist_m += s.dist_m);
      chunks.push({ km: currentKm, dist_km: dist_m / 1000, segs, localCosts, totalCost });
      currentKm += gran_km;
      startIdx = i + 1;
    }
  }

  return chunks;
}

function computeChunkTimes(pacingChunks, T_target_sec) {
  let totalCost = 0;
  pacingChunks.forEach(c => totalCost += c.totalCost);

  pacingChunks.forEach(chunk => {
    chunk.time_sec = T_target_sec * (chunk.totalCost / totalCost);
  });

  const totalDist = pacingChunks.reduce((s, c) => s + c.dist_km, 0);
  const avgPaceSec   = T_target_sec / totalDist;
  const floorPaceSec = avgPaceSec * 0.55;

  let surplus = 0, slowTotalDist = 0;
  pacingChunks.forEach(chunk => {
    const chunkPace = chunk.time_sec / chunk.dist_km;
    if (chunkPace < floorPaceSec) {
      surplus += (floorPaceSec - chunkPace) * chunk.dist_km;
      chunk.time_sec = floorPaceSec * chunk.dist_km;
    } else {
      slowTotalDist += chunk.dist_km;
    }
  });

  if (surplus > 0 && slowTotalDist > 0) {
    pacingChunks.forEach(chunk => {
      if (chunk.time_sec / chunk.dist_km >= floorPaceSec) {
        chunk.time_sec += surplus * (chunk.dist_km / slowTotalDist);
      }
    });
  }

  let cumulative = 0;
  pacingChunks.forEach(chunk => {
    cumulative += chunk.time_sec;
    chunk.cumulative_sec = cumulative;
  });

  return pacingChunks;
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Genera il piano pacing da punti GPX, metriche e parametri.
 *
 * @param {object} opts
 * @param {[number,number,number][]} opts.gpxPts  — track points
 * @param {{ km, gain, e, d }} opts.metrics        — da gpx-node.compute()
 * @param {{ terrainClass, meteo, alt }} opts.params
 * @param {number} opts.T_target_sec               — tempo obiettivo in secondi
 * @param {number} [opts.gran_km=5]                — granularità chunk in km
 * @returns {{ pacingChunks, granularity_km, target_time, avg_pace_sec }} | { error }
 */
export function generatePacingPlan({ gpxPts, metrics, params, T_target_sec, gran_km = 5 }) {
  const segments = buildSegments(gpxPts, metrics);
  if (!segments.length) return { error: 'Traccia insufficiente.' };

  const pacingChunks = buildPacingChunks(segments, params, gran_km);
  const enriched     = computeChunkTimes(pacingChunks, T_target_sec);

  const totalDist  = enriched.reduce((s, c) => s + c.dist_km, 0);
  const avgPaceSec = T_target_sec / Math.max(totalDist, 1e-6);

  return {
    pacingChunks:  enriched,
    granularity_km: gran_km,
    target_time:   T_target_sec,
    avg_pace_sec:  avgPaceSec,
  };
}

/**
 * Serializza i chunk in un array JSON-friendly per la risposta API.
 */
export function serializeChunks(pacingChunks, avgPaceSec) {
  return pacingChunks.map(chunk => {
    const paceSec = chunk.time_sec / chunk.dist_km;
    const dplus   = Math.round(chunk.segs.reduce((s, seg) => s + Math.max(0, seg.elev_diff || 0), 0));
    const dminus  = Math.round(chunk.segs.reduce((s, seg) => s + Math.max(0, -(seg.elev_diff || 0)), 0));
    return {
      km_end:        chunk.km,
      dist_km:       Math.round(chunk.dist_km * 100) / 100,
      pace_sec_km:   Math.round(paceSec),
      pace_str:      secToPaceStr(paceSec),
      time_str:      secToHMS(chunk.cumulative_sec),
      cumulative_sec: Math.round(chunk.cumulative_sec),
      dplus,
      dminus,
      faster_than_avg: paceSec < avgPaceSec,
    };
  });
}
