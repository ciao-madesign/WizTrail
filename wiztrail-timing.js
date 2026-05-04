/**
 * wiztrail-timing.js — Motore di stima tempi trail condiviso
 * Esposto come window.WizTrailTiming
 *
 * Usato da: main.js (calcolatore) e training-analyzer.html
 * Dipende da: gpx-parser.js (GPXParser.smoothElevation, GPXParser.computeSegments)
 */
(function () {
  'use strict';

  /* Riduzione velocità base per superficie del trail sui tratti pianeggianti.
     Su terreno E l'atleta corre sostanzialmente al passo su strada;
     su EE/EA la superficie tecnica rallenta anche in piano. */
  const TRAIL_BASE_FACTOR = { 'Strada': 1.00, 'E': 1.00, 'EE': 0.85, 'EA': 0.75 };

  /* ------------------------------------------------------------------
     velocityFromSlope(p, S, velBase)
     p        = pendenza (positiva salita, negativa discesa), es. 0.10 = 10%
     S        = specificità trail [0=principiante, 1=elite]
     velBase  = velocità base piano (km/h)
     Restituisce la velocità (km/h) sul segmento
     ------------------------------------------------------------------ */
  function velocityFromSlope(p, S, velBase) {
    if (Math.abs(p) < 0.015) return velBase;

    if (p > 0) {
      // Salita: coefficiente dipende da S
      // S=1 (elite): k=1.5 — poca penalità su salite moderate
      // S=0 (principiante): k=4.0 — forte rallentamento anche su pendenze medie
      const k = 1.5 + 2.5 * (1 - S);
      const cap = 1.6 + 0.9 * (1 - S);  // S=1: cap 1.6  S=0.5: 2.05  S=0: 2.5
      return velBase / Math.min(1 + k * p, cap);
    }

    // Discesa: elite accelera nettamente, beginner poco
    // La tecnica di discesa è il principale vantaggio dell'elite sul trail
    const boost = 1.05 + 0.25 * S;       // S=1: 1.30×  S=0.5: 1.175×  S=0: 1.05×
    if (p < -0.25) {
      // Discesa estrema: beginner rallenta, elite tiene il boost
      const steep = (1 - S) * (Math.abs(p) - 0.25) * 2;
      return velBase * Math.max(boost - steep, 0.85);
    }
    return velBase * boost;
  }

  /* ------------------------------------------------------------------
     technicalPenalty(slope, terrainClass)
     Penalità extra per tecnicità del terreno su sezioni ripide.
     Restituisce un moltiplicatore di rallentamento (0 = nessuna penalità).
     ------------------------------------------------------------------ */
  function technicalPenalty(slope, terrainClass) {
    if (terrainClass === 'E')   return 0;
    if (terrainClass === 'EE' && (slope > 0.08 || slope < -0.10)) return 0.12;
    if (terrainClass === 'EA' && (slope > 0.08 || slope < -0.10)) return 0.28;
    return 0;
  }

  /* ------------------------------------------------------------------
     fatigueFactor(t_hours)
     Fatica progressiva — calibrata su atleti allenati.
     +5% dopo 1h, +19% dopo 3h, +36% dopo 6h.
     ------------------------------------------------------------------ */
  function fatigueFactor(t_hours) {
    return 1 + 0.6 * Math.pow(t_hours / 8, 1.2);
  }

  /* ------------------------------------------------------------------
     computeTime(pts, metrics, velBase, S, terrainClass, meteo, alt)
     Stima il tempo di percorrenza in secondi tramite il modello a segmenti.

     pts          = array [[lat,lon,ele], ...]
     metrics      = oggetto { km, gain, e[], d[] } da GPXParser.compute()
     velBase      = velocità di riferimento su piano su strada (km/h)
     S            = specificità trail [0–1]
     terrainClass = 'Strada' | 'E' | 'EE' | 'EA'
     meteo        = fattore meteo [1=normale, >1=penalità] (default 1)
     alt          = fattore altitudine [1=piano] (default 1)
     manualGain   = D+ manuale in metri se il GPX non ha elevazione (default 0)

     Restituisce T in secondi.
     ------------------------------------------------------------------ */
  function computeTime(pts, metrics, velBase, S, terrainClass, meteo, alt, manualGain) {
    if (!pts || pts.length < 2) return 0;

    terrainClass = terrainClass || 'E';
    meteo        = meteo || 1;
    alt          = alt   || 1;
    manualGain   = manualGain || 0;

    const velBaseEff = velBase * (TRAIL_BASE_FACTOR[terrainClass] ?? 0.90);
    const elev_s     = GPXParser.smoothElevation(metrics.e);
    const segments   = GPXParser.computeSegments(pts, metrics.d, elev_s);

    let T = 0;
    segments.forEach(function (seg) {
      const velLocal = velocityFromSlope(seg.slope, S, velBaseEff);
      const tech     = technicalPenalty(seg.slope, terrainClass);
      const velTech  = velLocal / (1 + tech);
      const t_raw    = seg.dist / (velTech * 1000 / 3600);
      const fat      = fatigueFactor(T / 3600);
      T += t_raw * fat;
    });

    // Se il GPX non ha elevazione, aggiungi correzione da D+ manuale
    if (metrics.gain === 0 && manualGain > 0) {
      T += (manualGain / 8) * 60;
    }

    // Fattori meteo / altitudine
    const T_hours = T / 3600;
    T *= 1 + (meteo - 1) * (T_hours / 5);
    T *= alt;

    return T;
  }

  /* ------------------------------------------------------------------
     levelFromS(S) — etichetta livello dall'slider specificità
     ------------------------------------------------------------------ */
  function levelFromS(S) {
    if (S >= 0.9) return 'Élite';
    if (S >= 0.7) return 'Agonista';
    if (S >= 0.5) return 'Amatore forte';
    if (S >= 0.3) return 'Amatore avanzato';
    if (S >= 0.1) return 'Amatore';
    return 'Principiante';
  }

  window.WizTrailTiming = {
    TRAIL_BASE_FACTOR:  TRAIL_BASE_FACTOR,
    velocityFromSlope:  velocityFromSlope,
    technicalPenalty:   technicalPenalty,
    fatigueFactor:      fatigueFactor,
    computeTime:        computeTime,
    levelFromS:         levelFromS,
  };

})();
