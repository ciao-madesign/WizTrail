/**
 * wiztrail-timing.js — Motore di stima tempi trail condiviso
 * Esposto come window.WizTrailTiming
 *
 * Usato da: main.js (calcolatore) e training-analyzer.html
 * Dipende da: gpx-parser.js (GPXParser.smoothElevation, GPXParser.computeSegments)
 *
 * I parametri in VELOCITY_PARAMS vengono aggiornati dalla pipeline di calibrazione
 * (wiztrail-calibration/scripts/03_calibrate.py Parte B → patch via 04_insights.py).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     VELOCITY_PARAMS — parametri calibrati dalla pipeline Python
     Aggiornare dopo ogni run di calibrazione con i valori dal patch JS.
     Ultima calibrazione: vedi wiztrail-calibration/output/4_wiztrail_patch.js
     ------------------------------------------------------------------ */
  const VELOCITY_PARAMS = {
    k_base:        1.5,   // coefficiente salita per elite (S=1)
    k_spread:      2.5,   // quanto S amplifica la penalità in salita
    cap_base:      1.6,   // tetto rallentamento salita (elite)
    cap_spread:    0.9,   // spread del tetto tra elite e principiante
    boost_base:    1.05,  // boost discesa per principiante (S=0)
    boost_S:       0.25,  // quanto S amplifica il boost in discesa
    fatigue_coeff: 0.6,   // intensità fatica progressiva
  };

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
     Usa VELOCITY_PARAMS.fatigue_coeff.
     ------------------------------------------------------------------ */
  function fatigueFactor(t_hours) {
    return 1 + VELOCITY_PARAMS.fatigue_coeff * Math.pow(t_hours / 8, 1.2);
  }

  /* ------------------------------------------------------------------
     computeTime(pts, metrics, velBase, S, terrainClass, meteo, alt, manualGain)
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

    if (metrics.gain === 0 && manualGain > 0) {
      T += (manualGain / 8) * 60;
    }

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
    VELOCITY_PARAMS:    VELOCITY_PARAMS,
    TRAIL_BASE_FACTOR:  TRAIL_BASE_FACTOR,
    velocityFromSlope:  velocityFromSlope,
    technicalPenalty:   technicalPenalty,
    fatigueFactor:      fatigueFactor,
    computeTime:        computeTime,
    levelFromS:         levelFromS,
  };

})();
