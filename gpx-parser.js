/**
 * gpx-parser.js — WizTrail GPX/TCX/SML Parser & Metrics
 * Esposto come window.GPXParser = { parseTrack, parseTrackFull, compute,
 *                                    smoothElevation, hav, clampSlope, computeSegments }
 * parseTrack(xml)     → [[lat,lon,ele], ...]
 * parseTrackFull(xml) → { pts, times } — include timestamp per durata reale
 * compute() restituisce { km, gain, e[], d[], max_altitude }
 *
 * Formati supportati: GPX trkpt, GPX rtept (Komoot), TCX Trackpoint, Suunto SML Sample
 *
 * PORT SERVER-SIDE: api/lib/gpx-node.js — ogni modifica alla logica di parsing,
 * sanitizzazione o calcolo metriche va replicata anche lì (engine drift).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1) HAVERSINE — distanza in metri tra due coordinate GPS
     ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------
     PRIVATE: XML parse error detection (DOMParser injection)
     ------------------------------------------------------------------ */
  function _hasParseError(xml) {
    return xml.getElementsByTagName('parseerror').length > 0;
  }

  /* ------------------------------------------------------------------
     PRIVATE: Robust timestamp parsing
     ------------------------------------------------------------------ */
  function _parseTime(str) {
    if (!str) return null;
    try {
      const t = Date.parse(str);
      return Number.isFinite(t) ? t / 1000 : null;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------
     PRIVATE: Point sanitization
     - Scarta lat/lon NaN
     - Scarta null island (0,0)
     - Ripristina elevazione fuori range (<-500 / >9000 m)
     - Rimuove duplicati consecutivi
     - Smonta spike di elevazione (>400 m in un singolo punto)
     ------------------------------------------------------------------ */
  function _sanitizePts(pts) {
    const out = [];
    let prevEle = null;

    for (let i = 0; i < pts.length; i++) {
      const [la, lo, el] = pts[i];

      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      if (la === 0 && lo === 0) continue;

      // Validate elevation; null = invalid/use fallback
      let ele = Number.isFinite(el) ? el : null;
      if (ele !== null && (ele < -500 || ele > 9000)) ele = null;
      if (ele !== null && prevEle !== null && Math.abs(ele - prevEle) > 400) ele = null;
      ele = ele !== null ? ele : (prevEle !== null ? prevEle : 0);

      // Skip consecutive duplicates
      if (out.length > 0) {
        const prev = out[out.length - 1];
        if (la === prev[0] && lo === prev[1]) continue;
      }

      out.push([la, lo, ele]);
      prevEle = ele;
    }

    return out;
  }

  /* ------------------------------------------------------------------
     PRIVATE: Douglas-Peucker decimation (iterative, stack-based)
     Riduce tracce dense preservando la forma visiva
     ------------------------------------------------------------------ */
  function _perpDist(pt, a, b) {
    const x0 = pt[1], y0 = pt[0];
    const x1 = a[1],  y1 = a[0];
    const x2 = b[1],  y2 = b[0];
    const dx = x2 - x1, dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(x0 - x1, y0 - y1);
    return Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
  }

  function _decimatePts(pts, maxPts) {
    maxPts = maxPts || 5000;
    if (pts.length <= maxPts) return pts;

    let epsilon = 0.0001; // ~10 m in gradi
    let indices;

    do {
      const keep = new Uint8Array(pts.length);
      keep[0] = keep[pts.length - 1] = 1;
      const stack = [[0, pts.length - 1]];

      while (stack.length) {
        const seg = stack.pop();
        const s = seg[0], e = seg[1];
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

    return indices.map(function (i) { return pts[i]; });
  }

  /* ------------------------------------------------------------------
     PRIVATE PARSERS — estraggono punti da vari formati XML
     ------------------------------------------------------------------ */

  // GPX trkpt / rtept (stessa struttura)
  function _parseGPXNodes(nodes) {
    const pts = [], times = [];
    Array.prototype.forEach.call(nodes, function (n) {
      const la = parseFloat(n.getAttribute('lat'));
      const lo = parseFloat(n.getAttribute('lon'));
      const e  = n.getElementsByTagName('ele')[0];
      pts.push([la, lo, e ? parseFloat(e.textContent) : 0]);
      const tEl = n.getElementsByTagName('time')[0];
      const ts  = _parseTime(tEl ? tEl.textContent : null);
      if (ts !== null) times.push(ts);
    });
    return { pts: pts, times: times };
  }

  // TCX Trackpoint
  function _parseTCXNodes(nodes) {
    const pts = [], times = [];
    Array.prototype.forEach.call(nodes, function (n) {
      const p = n.getElementsByTagName('Position')[0];
      if (!p) return;
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
    });
    return { pts: pts, times: times };
  }

  // Suunto SML — lat/lon in radianti, conversione obbligatoria
  function _parseSuuntoNodes(nodes) {
    const R2D = 180 / Math.PI;
    const pts = [], times = [];
    Array.prototype.forEach.call(nodes, function (n) {
      const laEl = n.getElementsByTagName('Latitude')[0];
      const loEl = n.getElementsByTagName('Longitude')[0];
      if (!laEl || !loEl) return;
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
    });
    return { pts: pts, times: times };
  }

  /* ------------------------------------------------------------------
     2b) PARSE TRACK FULL — include timestamp per calcolo durata reale
     Cascade formati: GPX trkpt → GPX rtept → TCX → Suunto SML
     Restituisce { pts: [[lat,lon,ele],...], times: [epoch_sec,...] }
     ------------------------------------------------------------------ */
  function parseTrackFull(xml) {
    if (_hasParseError(xml)) {
      console.warn('[GPXParser] XML parse error nel file caricato');
      return { pts: [], times: [] };
    }

    var raw;

    // 1. GPX standard
    var trkpt = xml.getElementsByTagName('trkpt');
    if (trkpt.length) {
      raw = _parseGPXNodes(trkpt);
    } else {
      // 2. GPX route (Komoot e simili)
      var rtept = xml.getElementsByTagName('rtept');
      if (rtept.length) {
        raw = _parseGPXNodes(rtept);
      } else {
        // 3. TCX
        var tcx = xml.getElementsByTagName('Trackpoint');
        if (tcx.length) {
          raw = _parseTCXNodes(tcx);
        } else {
          // 4. Suunto SML — filtro i Sample che contengono posizione GPS
          var allSamples = xml.getElementsByTagName('Sample');
          var sml = Array.prototype.filter.call(allSamples, function (n) {
            return n.getElementsByTagName('Latitude').length > 0;
          });
          if (sml.length) {
            raw = _parseSuuntoNodes(sml);
          } else {
            return { pts: [], times: [] };
          }
        }
      }
    }

    var cleanPts  = _sanitizePts(raw.pts);
    var finalPts  = _decimatePts(cleanPts);

    return { pts: finalPts, times: raw.times };
  }

  /* ------------------------------------------------------------------
     2) PARSE TRACK
     Restituisce array di punti [lat, lon, ele]
     ------------------------------------------------------------------ */
  function parseTrack(xml) {
    return parseTrackFull(xml).pts;
  }

  /* ------------------------------------------------------------------
     3) COMPUTE METRICS
     Calcola { km, gain, e[], d[], max_altitude } dai punti GPS
     ------------------------------------------------------------------ */
  function compute(pts) {
    if (pts.length < 2) return { km: 0, gain: 0, e: [], d: [], max_altitude: 0 };

    const elev = pts.map(function (p) { return p[2]; });

    // Smoothing adattivo: riduce rumore GPS senza perdere dislivello reale
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
      if (dd < 300) dist += dd;   // scarta salti GPS anomali
      d[i] = dist;
    }

    // D+ con isteresi solo su tracce piatte (range quota < 30 m post-smoothing):
    // il per-step threshold annulla salite reali quando lo smoothing le spalma
    // sotto 1.5 m/step. Su tracce mountain (range >= 30 m) l'algoritmo originale
    // è invariato — la calibrazione su 96 gare resta valida.
    const elevRange = Math.max(...elevS) - Math.min(...elevS);
    if (elevRange < 30) {
      let gainLow = elevS[0], gainHigh = elevS[0];
      for (let i = 1; i < elevS.length; i++) {
        const e = elevS[i];
        if (e > gainHigh) {
          gainHigh = e;
        } else if (gainHigh - e >= 3) {
          if (gainHigh - gainLow >= 3) gain += gainHigh - gainLow;
          gainLow = e; gainHigh = e;
        }
        if (e < gainLow) { gainLow = e; gainHigh = e; }
      }
      if (gainHigh - gainLow >= 3) gain += gainHigh - gainLow;
    } else {
      for (let i = 1; i < elevS.length; i++) {
        const de = elevS[i] - elevS[i - 1];
        if (de > 1.5) gain += de;
      }
    }

    // -Infinity come seed per gestire correttamente tracce sotto il livello del mare
    const maxAltRaw = elev.reduce(function (m, v) {
      return Number.isFinite(v) && v > m ? v : m;
    }, -Infinity);
    const max_altitude = Number.isFinite(maxAltRaw) ? maxAltRaw : 0;

    return { km: dist / 1000, gain: gain, e: elev, d: d, max_altitude: max_altitude };
  }

  /* ------------------------------------------------------------------
     4) SMOOTH ELEVATION — media mobile anti-rumore
     ------------------------------------------------------------------ */
  function smoothElevation(elev, windowSize) {
    windowSize = windowSize || 5;
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

  /* ------------------------------------------------------------------
     5) CLAMP SLOPE — taglia pendenze impossibili (spike GPS)
     ------------------------------------------------------------------ */
  function clampSlope(dh, dd, maxSlope) {
    maxSlope = maxSlope || 0.35;
    const rawSlope = dh / dd;
    return Math.abs(rawSlope) > maxSlope
      ? Math.sign(rawSlope) * maxSlope
      : rawSlope;
  }

  /* ------------------------------------------------------------------
     6) COMPUTE SEGMENTS — suddivide il percorso in micro-segmenti
     Ogni segmento ha: { dist, dh, slope, idxStart, idxEnd }
     ------------------------------------------------------------------ */
  function computeSegments(pts, dist, elev, segLength) {
    segLength = segLength || 80;
    const segments = [];
    let lastIndex = 0;

    for (let i = 1; i < pts.length; i++) {
      const d = dist[i] - dist[lastIndex];

      if (d >= segLength) {
        const dh = elev[i] - elev[lastIndex];
        segments.push({
          dist: d,
          dh: dh,
          slope: clampSlope(dh, d),
          idxStart: lastIndex,
          idxEnd: i,
        });
        lastIndex = i;
      }
    }

    return segments;
  }

  /* ------------------------------------------------------------------
     Esposizione globale — API identica alla versione precedente
     ------------------------------------------------------------------ */
  window.GPXParser = {
    parseTrack:      parseTrack,
    parseTrackFull:  parseTrackFull,
    compute:         compute,
    smoothElevation: smoothElevation,
    hav:             hav,
    clampSlope:      clampSlope,
    computeSegments: computeSegments,
  };

})();
