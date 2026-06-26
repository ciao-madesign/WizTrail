/**
 * wiztrail-timing.js — Motore di stima tempi trail condiviso
 * Esposto come window.WizTrailTiming
 *
 * Usato da: main.js (calcolatore) e training-analyzer.html
 * Dipende da: gpx-parser.js (GPXParser.smoothElevation, GPXParser.computeSegments)
 *
 * I parametri in VELOCITY_PARAMS vengono aggiornati dalla pipeline di calibrazione
 * (wiztrail-calibration/scripts/03_calibrate.py Parte B → patch via 04_insights.py).
 * I parametri in KF_TERRAIN_PARAMS (Fase 12) sono calibrabili via PATCH hub?action=patch.
 *
 * PORT SERVER-SIDE: api/lib/timing-node.js — ogni modifica a VELOCITY_PARAMS,
 * KF_TERRAIN_PARAMS, TRAIL_BASE_FACTOR o alle formule va replicata anche lì (engine drift).
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
    fatigue_coeff: 0.6471, // calibrato su 39 GPX reali (03_calibrate.py, 26/06/2026)
  };

  /* Riduzione velocità base per superficie del trail sui tratti pianeggianti.
     Su terreno E l'atleta corre sostanzialmente al passo su strada;
     su EE/EA la superficie tecnica rallenta anche in piano. */
  const TRAIL_BASE_FACTOR = { 'Strada': 1.00, 'E': 1.00, 'EE': 0.85, 'EA': 0.75 };

  /* ------------------------------------------------------------------
     KF_TERRAIN_PARAMS — fattore di correzione tecnicità per stima personalizzata (Fase 12)
     Corregge la sottostima sistematica del modello a segmenti su percorsi tecnici.
     Il modello cattura pendenza e fatica, ma non la tecnicità continua del terreno
     (irregolarità, rocce, radici, esposizione) misurata dal TechScore.

     USA TechScore (non WDI): WDI include distanza e dislivello già modellati
     dal timing engine — usarlo causerebbe double-counting. TechScore è puramente
     f(FRIP, SlopeVar, Roughness, surfaceLevel): il componente genuinamente mancante.

     Aggiornabili via PATCH /api/hub?action=patch:
     { timing: { kf_terrain: { tech_scale: X, specificity_weight: Y } } }

     tech_scale         — divisore TechScore (0–100): aumentare riduce l'impatto
     specificity_weight — quanto S riduce il fattore [0=nessuna differenza, 1=elite immune]
     ------------------------------------------------------------------ */
  const KF_TERRAIN_PARAMS = {
    tech_scale:         175,  // calibrato su 39 GPX reali (02c_calibrate_kf_terrain.py, 26/06/2026)
    specificity_weight: 0.45, // calibrato su 39 GPX reali (02c_calibrate_kf_terrain.py, 26/06/2026)
  };

  /* terrainFactor(techScore, S)
     Restituisce il fattore moltiplicativo sul tempo base (sempre ≥ 1).
     TechScore basso (trail scorrevole): KF ≈ 1 → quasi nessun impatto.
     TechScore alto (skyrace, pietraia) + S basso: KF più elevato → stima conservativa.
     S alto (trail specialist) riduce il fattore: la tecnicità frena meno chi è specializzato. */
  function terrainFactor(techScore, S) {
    const p = KF_TERRAIN_PARAMS;
    return 1 + (techScore / p.tech_scale) * (1 - S * p.specificity_weight);
  }

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

  /* Cap fatica: senza limite UTMB +39%, TOR +769% (analisi 39 GPX, 02b_timing_vs_reality.py).
     Entra in gioco da ~18h in poi — non tocca gare normali. */
  const FATIGUE_CAP = 2.5;

  /* ------------------------------------------------------------------
     fatigueFactor(t_hours)
     Fatica progressiva — calibrata su atleti allenati.
     Usa VELOCITY_PARAMS.fatigue_coeff. Cap a FATIGUE_CAP per ultra.
     ------------------------------------------------------------------ */
  function fatigueFactor(t_hours) {
    return Math.min(
      1 + VELOCITY_PARAMS.fatigue_coeff * Math.pow(t_hours / 8, 1.2),
      FATIGUE_CAP
    );
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

  /* ------------------------------------------------------------------
     MEDIAN_MODEL — coefficienti power-law calibrati su 32.402 gare trail
     Fonte: UTMB World Race Data, Maarten Poirot (Kaggle, kaggle.com/datasets/mgpoirot/utmb-world-race-daa)
     Dati originali: UTMB World (utmb.world) — risultati gare pubblici
     Aggiornare con: wiztrail-calibration/scripts/00b_fit_median_model.py

     Formula: T_median_h = a × km^b × (D+/1000)^c × exp(d × alt_km)
     dove alt_km = quota media in km s.l.m.
     ------------------------------------------------------------------ */
  const MEDIAN_MODEL = {
    short:  { a: 0.370641, b: 0.6944, c: 0.3586, d: 0.0552 },  // ≤ 25 km
    medium: { a: 0.321490, b: 0.7445, c: 0.3466, d: 0.0587 },  // 26–50 km
    long:   { a: 0.305509, b: 0.7651, c: 0.3555, d: 0.0433 },  // 51–95 km
    ultra:  { a: 0.249561, b: 0.8286, c: 0.3501, d: 0.0256 },  // > 95 km
  };

  /* Sigma della distribuzione log-normale dei tempi di arrivo per categoria.
     Calibrato sui Results individuali del dataset UTMB (distribuzione empirica).
     Usato da estimatePercentile() per stimare la posizione dell'atleta nel campo. */
  const PERCENTILE_SIGMA = {
    short:  0.203,
    medium: 0.181,
    long:   0.166,
    ultra:  0.167,
  };

  /* normCDF(z) — approssimazione Φ(z) distribuzione normale standard
     Metodo: Abramowitz & Stegun, errore massimo < 7.5e-8 */
  function normCDF(z) {
    const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const poly = t * (b[0] + t * (b[1] + t * (b[2] + t * (b[3] + t * b[4]))));
    const cdf = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
    return z >= 0 ? cdf : 1 - cdf;
  }

  function _distCat(km) {
    if (km <= 25) return 'short';
    if (km <= 50) return 'medium';
    if (km <= 95) return 'long';
    return 'ultra';
  }

  /* estimateMedianTime(km, dplus, altM)
     Stima il tempo mediano di gara (secondi) per una gara con queste caratteristiche.
     altM = quota media stimata in metri s.l.m. (opzionale, default 0) */
  function estimateMedianTime(km, dplus, altM) {
    if (!km || km <= 0 || !dplus || dplus <= 0) return null;
    const cat   = _distCat(km);
    const m     = MEDIAN_MODEL[cat];
    const altKm = (altM || 0) / 1000;
    return m.a * Math.pow(km, m.b) * Math.pow(dplus / 1000, m.c) * Math.exp(m.d * altKm) * 3600;
  }

  /* estimatePercentile(T_personal_sec, T_median_sec, km)
     Stima la percentuale di atleti che l'utente supera (= "top X%").
     Es. 72 → "top 72%" → l'atleta è più veloce del 72% dei finisher storici. */
  function estimatePercentile(T_personal_sec, T_median_sec, km) {
    if (!T_personal_sec || !T_median_sec || T_personal_sec <= 0 || T_median_sec <= 0) return null;
    const sigma = PERCENTILE_SIGMA[_distCat(km)];
    const z     = (Math.log(T_personal_sec) - Math.log(T_median_sec)) / sigma;
    return (1 - normCDF(z)) * 100;
  }

  window.WizTrailTiming = {
    VELOCITY_PARAMS:      VELOCITY_PARAMS,
    TRAIL_BASE_FACTOR:    TRAIL_BASE_FACTOR,
    KF_TERRAIN_PARAMS:    KF_TERRAIN_PARAMS,
    MEDIAN_MODEL:         MEDIAN_MODEL,
    PERCENTILE_SIGMA:     PERCENTILE_SIGMA,
    velocityFromSlope:    velocityFromSlope,
    technicalPenalty:     technicalPenalty,
    fatigueFactor:        fatigueFactor,
    computeTime:          computeTime,
    terrainFactor:        terrainFactor,
    levelFromS:           levelFromS,
    estimateMedianTime:   estimateMedianTime,
    estimatePercentile:   estimatePercentile,
  };

})();
