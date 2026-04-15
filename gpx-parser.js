/**
 * gpx-parser.js — WizTrail GPX/TCX Parser & Metrics
 * Estratto da index.html nel refactoring Fase 1.
 * Esposto come window.GPXParser = { parseTrack, compute, smoothElevation,
 *                                    hav, clampSlope, computeSegments }
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
     2) PARSE GPX / TCX
     Restituisce array di punti [lat, lon, ele]
     ------------------------------------------------------------------ */
  function parseTrack(xml) {
    const pts = [];

    // GPX: <trkpt>
    const g = xml.getElementsByTagName('trkpt');
    if (g.length) {
      [...g].forEach(n => {
        const la = parseFloat(n.getAttribute('lat'));
        const lo = parseFloat(n.getAttribute('lon'));
        const e  = n.getElementsByTagName('ele')[0];
        pts.push([la, lo, e ? parseFloat(e.textContent) : 0]);
      });
      return pts;
    }

    // TCX: <Trackpoint>
    const t = xml.getElementsByTagName('Trackpoint');
    [...t].forEach(n => {
      const p  = n.getElementsByTagName('Position')[0];
      if (!p) return;
      const la = p.getElementsByTagName('LatitudeDegrees')[0];
      const lo = p.getElementsByTagName('LongitudeDegrees')[0];
      const el = n.getElementsByTagName('AltitudeMeters')[0];
      pts.push([
        la ? parseFloat(la.textContent) : 0,
        lo ? parseFloat(lo.textContent) : 0,
        el ? parseFloat(el.textContent) : 0,
      ]);
    });
    return pts;
  }

  /* ------------------------------------------------------------------
     3) COMPUTE METRICS
     Calcola { km, gain, e[], d[] } dai punti GPS
     ------------------------------------------------------------------ */
  function compute(pts) {
    if (pts.length < 2) return { km: 0, gain: 0, e: [], d: [] };

    const elev = pts.map(p => p[2]);
    const d    = [0];
    let dist = 0, gain = 0;

    for (let i = 1; i < pts.length; i++) {
      const dd = hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      if (dd < 300) dist += dd;   // scarta salti GPS anomali
      d[i] = dist;
      const de = elev[i] - elev[i - 1];
      if (de > 1) gain += de;
    }

    return { km: dist / 1000, gain, e: elev, d };
  }

  /* ------------------------------------------------------------------
     4) SMOOTH ELEVATION — media mobile anti-rumore
     ------------------------------------------------------------------ */
  function smoothElevation(elev, windowSize = 5) {
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
  function clampSlope(dh, dd, maxSlope = 0.35) {
    const rawSlope = dh / dd;
    return Math.abs(rawSlope) > maxSlope
      ? Math.sign(rawSlope) * maxSlope
      : rawSlope;
  }

  /* ------------------------------------------------------------------
     6) COMPUTE SEGMENTS — suddivide il percorso in micro-segmenti
     Ogni segmento ha: { dist, dh, slope, idxStart, idxEnd }
     ------------------------------------------------------------------ */
  function computeSegments(pts, dist, elev, segLength = 80) {
    const segments = [];
    let lastIndex = 0;

    for (let i = 1; i < pts.length; i++) {
      const d = dist[i] - dist[lastIndex];

      if (d >= segLength) {
        const dh = elev[i] - elev[lastIndex];
        segments.push({
          dist: d,
          dh,
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
     Esposizione globale
     ------------------------------------------------------------------ */
  window.GPXParser = { parseTrack, compute, smoothElevation, hav, clampSlope, computeSegments };

})();
