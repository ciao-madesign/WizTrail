/**
 * gpx-node.js — GPX/TCX/SML parser per Node.js
 * Port di gpx-parser.js: stessa logica, usa @xmldom/xmldom invece di DOMParser.
 *
 * IMPORTANTE: tenere sincronizzato con gpx-parser.js.
 * Formati supportati: GPX trkpt, GPX rtept, TCX Trackpoint, Suunto SML Sample.
 */

import { DOMParser } from '@xmldom/xmldom';

/* ── Haversine ────────────────────────────────────────────────────── */

function hav(a, b, c, d) {
  const R = 6371000;
  const t = Math.PI / 180;
  const dLat = (c - a) * t;
  const dLon = (d - b) * t;
  const k =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a * t) * Math.cos(c * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(k));
}

/* ── Utilities ────────────────────────────────────────────────────── */

function _parseTime(str) {
  if (!str) return null;
  try {
    const t = Date.parse(str);
    return Number.isFinite(t) ? t / 1000 : null;
  } catch { return null; }
}

function _sanitizePts(pts) {
  const out = [];
  let prevEle = null;
  for (let i = 0; i < pts.length; i++) {
    const [la, lo, el] = pts[i];
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (la === 0 && lo === 0) continue;
    let ele = Number.isFinite(el) ? el : null;
    if (ele !== null && (ele < -500 || ele > 9000)) ele = null;
    if (ele !== null && prevEle !== null && Math.abs(ele - prevEle) > 400) ele = null;
    ele = ele !== null ? ele : (prevEle !== null ? prevEle : 0);
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (la === prev[0] && lo === prev[1]) continue;
    }
    out.push([la, lo, ele]);
    prevEle = ele;
  }
  return out;
}

function _perpDist(pt, a, b) {
  const x0 = pt[1], y0 = pt[0];
  const x1 = a[1],  y1 = a[0];
  const x2 = b[1],  y2 = b[0];
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x0 - x1, y0 - y1);
  return Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

function _decimatePts(pts, maxPts = 5000) {
  if (pts.length <= maxPts) return pts;
  let epsilon = 0.0001;
  let indices;
  do {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      if (e <= s + 1) continue;
      let maxD = 0, maxI = s;
      for (let i = s + 1; i < e; i++) {
        const d = _perpDist(pts[i], pts[s], pts[e]);
        if (d > maxD) { maxD = d; maxI = i; }
      }
      if (maxD > epsilon) {
        keep[maxI] = 1;
        stack.push([s, maxI], [maxI, e]);
      }
    }
    indices = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) indices.push(i);
    epsilon *= 2;
  } while (indices.length > maxPts && epsilon < 0.2);
  return indices.map(i => pts[i]);
}

/* ── Format-specific parsers ──────────────────────────────────────── */

function _parseGPXNodes(nodes) {
  const pts = [], times = [];
  for (const n of Array.from(nodes)) {
    const la = parseFloat(n.getAttribute('lat'));
    const lo = parseFloat(n.getAttribute('lon'));
    const e  = n.getElementsByTagName('ele')[0];
    pts.push([la, lo, e ? parseFloat(e.textContent) : 0]);
    const tEl = n.getElementsByTagName('time')[0];
    const ts  = _parseTime(tEl ? tEl.textContent : null);
    if (ts !== null) times.push(ts);
  }
  return { pts, times };
}

function _parseTCXNodes(nodes) {
  const pts = [], times = [];
  for (const n of Array.from(nodes)) {
    const p = n.getElementsByTagName('Position')[0];
    if (!p) continue;
    const la = p.getElementsByTagName('LatitudeDegrees')[0];
    const lo = p.getElementsByTagName('LongitudeDegrees')[0];
    const el = n.getElementsByTagName('AltitudeMeters')[0];
    pts.push([
      la ? parseFloat(la.textContent) : NaN,
      lo ? parseFloat(lo.textContent) : NaN,
      el ? parseFloat(el.textContent) : 0,
    ]);
    const tEl = n.getElementsByTagName('Time')[0];
    const ts  = _parseTime(tEl ? tEl.textContent : null);
    if (ts !== null) times.push(ts);
  }
  return { pts, times };
}

function _parseSuuntoNodes(nodes) {
  const R2D = 180 / Math.PI;
  const pts = [], times = [];
  for (const n of Array.from(nodes)) {
    const laEl = n.getElementsByTagName('Latitude')[0];
    const loEl = n.getElementsByTagName('Longitude')[0];
    if (!laEl || !loEl) continue;
    const elEl = n.getElementsByTagName('Altitude')[0];
    pts.push([
      parseFloat(laEl.textContent) * R2D,
      parseFloat(loEl.textContent) * R2D,
      elEl ? parseFloat(elEl.textContent) : 0,
    ]);
    const tEl = n.getElementsByTagName('UTC')[0]
             || n.getElementsByTagName('TimeISO8601')[0];
    const ts  = _parseTime(tEl ? tEl.textContent : null);
    if (ts !== null) times.push(ts);
  }
  return { pts, times };
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Parses an XML string (GPX/TCX/SML) and returns track points.
 * @param {string} xmlStr
 * @returns {{ pts: [number,number,number][], times: number[] }}
 */
export function parseTrackFull(xmlStr) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlStr, 'application/xml');

  if (xml.getElementsByTagName('parseerror').length > 0) {
    return { pts: [], times: [] };
  }

  let raw;
  const trkpt = xml.getElementsByTagName('trkpt');
  if (trkpt.length) {
    raw = _parseGPXNodes(trkpt);
  } else {
    const rtept = xml.getElementsByTagName('rtept');
    if (rtept.length) {
      raw = _parseGPXNodes(rtept);
    } else {
      const tcx = xml.getElementsByTagName('Trackpoint');
      if (tcx.length) {
        raw = _parseTCXNodes(tcx);
      } else {
        const allSamples = xml.getElementsByTagName('Sample');
        const sml = Array.from(allSamples).filter(n =>
          n.getElementsByTagName('Latitude').length > 0
        );
        if (sml.length) {
          raw = _parseSuuntoNodes(sml);
        } else {
          return { pts: [], times: [] };
        }
      }
    }
  }

  return { pts: _decimatePts(_sanitizePts(raw.pts)), times: raw.times };
}

export function parseTrack(xmlStr) {
  return parseTrackFull(xmlStr).pts;
}

/**
 * Computes metrics from track points.
 * @param {[number,number,number][]} pts
 * @returns {{ km, gain, e, d, max_altitude }}
 */
export function compute(pts) {
  if (pts.length < 2) return { km: 0, gain: 0, e: [], d: [], max_altitude: 0 };

  const elev = pts.map(p => p[2]);
  const wSize = pts.length > 10000 ? 9 : pts.length > 3000 ? 5 : 3;
  const elevS = [];
  for (let i = 0; i < elev.length; i++) {
    let sum = 0, count = 0;
    for (let j = i - Math.floor(wSize / 2); j <= i + Math.floor(wSize / 2); j++) {
      if (j >= 0 && j < elev.length && Number.isFinite(elev[j])) { sum += elev[j]; count++; }
    }
    elevS.push(count > 0 ? sum / count : elev[i]);
  }

  const d = [0];
  let dist = 0, gain = 0;
  for (let i = 1; i < pts.length; i++) {
    const dd = hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (dd < 300) dist += dd;
    d[i] = dist;
    const de = elevS[i] - elevS[i - 1];
    if (de > 1.5) gain += de;
  }

  const maxAltRaw = elev.reduce((m, v) => Number.isFinite(v) && v > m ? v : m, -Infinity);
  const max_altitude = Number.isFinite(maxAltRaw) ? maxAltRaw : 0;

  return { km: dist / 1000, gain, e: elev, d, max_altitude };
}

export function smoothElevation(elev, windowSize = 5) {
  const smoothed = [];
  const w = Math.floor(windowSize / 2);
  for (let i = 0; i < elev.length; i++) {
    let sum = 0, count = 0;
    for (let k = -w; k <= w; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < elev.length) { sum += elev[idx]; count++; }
    }
    smoothed.push(sum / count);
  }
  return smoothed;
}

function clampSlope(dh, dd, maxSlope = 0.35) {
  const rawSlope = dh / dd;
  return Math.abs(rawSlope) > maxSlope ? Math.sign(rawSlope) * maxSlope : rawSlope;
}

export function computeSegments(pts, dist, elev, segLength = 80) {
  const segments = [];
  let lastIndex = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist[i] - dist[lastIndex];
    if (d >= segLength) {
      const dh = elev[i] - elev[lastIndex];
      segments.push({ dist: d, dh, slope: clampSlope(dh, d), idxStart: lastIndex, idxEnd: i });
      lastIndex = i;
    }
  }
  return segments;
}
