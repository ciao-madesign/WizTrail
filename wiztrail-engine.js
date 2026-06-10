/* ===============================================================
   WIZTRAIL ENGINE v5.1 — Unified Difficulty Model
   Sostituisce: wiztrail-racescore.js (WDI 9.1) e wiztrail-wdit.js (WDIT 7.0)
   Espone: window.WizTrail
   Caricato da: index.html (prima di main.js)

   Le soglie devono restare sincronizzate con:
     - map.js → getColorWDI()
     - ui.js → showWDI() e showTechScore()
     - api/lib/engine-node.js → PORT SERVER-SIDE: ogni modifica a soglie, kT, EXP
       o formule qui va replicata anche lì (engine drift rischio regressione API)
   kT = 0.50 → calibrato 20/04/2026 (era 0.35)
   normRough 0.500 → recalibrato 28/04/2026 (era 0.051, saturava su GPX reali)
   TERRAIN_DEFAULTS v3 → recalibrato 10/06/2026: fix saturazione normSVar
     (dopo cambio ref normSVar 0.55→0.180, tutti i valori slopeVar saturavano a 1.0)
   WDI_THRESHOLDS v3 → ricalibrate 05/05/2026 su 95 gare (v5.1 engine)
   =============================================================== */

window.WizTrail = (function () {

  const kT = 0.50;  // calibrato 20/04/2026 (era 0.35)

  /* ---------------------------------------------------------------
     NORMALIZZAZIONE WDI PER CATEGORIA DI DISTANZA
     
     Il WDI grezzo è usato internamente per tutti i calcoli
     (map.js, discipline-classifier, pacing, hub).
     Il WDI normalizzato (0–10 per categoria) è solo per display.
     
     Principio: stessa dignità a tutte le fasce di distanza.
     Le soglie grezze sono fisse e documentate — non cambiano
     con l'aggiunta di nuove gare al ranking.
     
     Categorie e scale grezze (v3 — ricalibrate 11/05/2026 su 31 gare):
       Short  ≤25km  : grezzo 15→ 65  → norm 0–10
       Medium 26–50km: grezzo 20→120  → norm 0–10
       Long   51–95km: grezzo 50→175  → norm 0–10
       Ultra  >95km  : grezzo 80→300  → norm 0–10 (Legend ∞ oltre 300)

     TechScore: scala assoluta 0–100, non categorizzata per distanza.
     --------------------------------------------------------------- */
  const WDI_NORM_CATEGORIES = [
    { distMax:  25, wdiMin: 15, wdiMax:  65, label: 'Short'  },
    { distMax:  50, wdiMin: 20, wdiMax: 120, label: 'Medium' },
    { distMax:  95, wdiMin: 50, wdiMax: 175, label: 'Long'   },
    { distMax: Infinity, wdiMin: 80, wdiMax: 300, label: 'Ultra' },
  ];

  /* ---------------------------------------------------------------
     SOGLIE — v3 calibrate su 95 gare (v5.1 engine, 05/05/2026)
     Sincronizzare con map.js → getColorWDI() e about.html → tabella classi
     --------------------------------------------------------------- */
  const WDI_THRESHOLDS = [
    { max:  22,      level: 'Sport',    color: '#2BB7DA' },
    { max:  40,      level: 'Pro',      color: '#34A853' },
    { max:  70,      level: 'Advanced', color: '#F4C20D' },
    { max: 120,      level: 'Extreme',  color: '#F79617' },
    { max: 200,      level: 'Elite',    color: '#E91E63' },
    { max: Infinity, level: 'Legend',   color: '#8E24AA' }
  ];

  /* TECH_THRESHOLDS — soglie su scala interna 0-100.
     Display: TechScore/10 (scala 0-10) — applicato in ui.js e training-analyzer.html.
     Ricalibrate 29/04/2026: MEHT21 (20km 1470D+) → ~76/100 → 7.6/10 → 'Molto tecnico' ✓
     Soglie alzate per riflettere la realtà dei terreni alpini. */
  const TECH_THRESHOLDS = [
    { max: 25,       level: 'Facile',        color: '#2BB7DA' },
    { max: 40,       level: 'Scorrevole',    color: '#34A853' },
    { max: 55,       level: 'Moderato',      color: '#F4C20D' },
    { max: 70,       level: 'Tecnico',       color: '#F79617' },
    { max: 85,       level: 'Molto tecnico', color: '#E91E63' },
    { max: 95,       level: 'Alpinistico',   color: '#8E24AA' },
    { max: Infinity, level: 'Estremo',       color: '#FF0080' }
  ];

  const SURFACE_MULT = { 1: 0.92, 2: 0.97, 3: 1.00, 4: 1.04, 5: 1.08 };

  /* TERRAIN_DEFAULTS v3 — usati in computeManual (senza GPX reale).
     Ricalibrati 10/06/2026: i precedenti valori slopeVar (0.38/0.55/0.70) saturavano
     tutti normSVar a 1.0 dopo il cambio del riferimento da 0.55 → 0.180, gonfiando
     il TechScore manuale di ~10 punti rispetto a GPX reali equivalenti.
     I nuovi valori coprono proporzionalmente l'intervallo naturale 0…0.180:
     E ≈ 45° percentile, EE ≈ 72° percentile, EA ≈ 94° percentile.
     E  = sentiero segnato con tratti tecnici, pendenze moderate
     EE = sentiero tecnico, pietraie, radici, pendenze sostenute
     EA = terreno alpinistico, roccia, creste, esposizione */
  const TERRAIN_DEFAULTS = {
    'E':  { frip: 0.25, slopeVar: 0.08, roughness: 0.10 },  // TechScore ~36 (Scorrevole)
    'EE': { frip: 0.48, slopeVar: 0.13, roughness: 0.20 },  // TechScore ~57 (Tecnico)
    'EA': { frip: 0.72, slopeVar: 0.17, roughness: 0.32 }   // TechScore ~76 (Molto tecnico)
  };

  /* ---------------------------------------------------------------
     FUNZIONI PRIVATE
     --------------------------------------------------------------- */
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /**
   * Restituisce la categoria WDI in base alla distanza.
   * @param {number} km
   * @returns {object} categoria da WDI_NORM_CATEGORIES
   */
  function getWdiCategory(km) {
    for (const cat of WDI_NORM_CATEGORIES) {
      if (km <= cat.distMax) return cat;
    }
    return WDI_NORM_CATEGORIES[WDI_NORM_CATEGORIES.length - 1];
  }

  /**
   * Normalizza il WDI grezzo su scala 0–10 per la sua categoria di distanza.
   * Oltre il massimo della categoria Ultra (300 grezzo) → 10 con flag isLegendPlus.
   * @param {number} wdi — WDI grezzo
   * @param {number} km  — distanza in km (determina la categoria)
   * @returns {{ norm: number, category: string, isLegendPlus: boolean }}
   */
  function normalizeWDI(wdi, km) {
    const cat  = getWdiCategory(km);
    const norm = (wdi - cat.wdiMin) / (cat.wdiMax - cat.wdiMin) * 10;
    const isLegendPlus = (cat.label === 'Ultra' && wdi > cat.wdiMax);
    return {
      norm:          Math.round(clamp(norm, 0, 10) * 10) / 10,
      category:      cat.label,
      isLegendPlus,
    };
  }

  function classifyBy(value, thresholds) {
    for (const t of thresholds) {
      if (value < t.max) return { level: t.level, color: t.color };
    }
    return thresholds[thresholds.length - 1];
  }

  function computeSlopes(d, e) {
    const slopes = [];
    for (let i = 1; i < d.length; i++) {
      const dd = d[i] - d[i - 1];
      if (dd > 0) slopes.push((e[i] - e[i - 1]) / dd);
    }
    return slopes;
  }

  function computeFRIP(d, e) {
    let maxSlope = 0;
    for (let i = 0; i < d.length; i++) {
      let j = i;
      while (j < d.length && d[j] < d[i] + 40) j++;
      if (j >= d.length) break;
      const slope = Math.abs((e[j] - e[i]) / Math.max(1, d[j] - d[i]));
      if (slope > maxSlope) maxSlope = slope;
    }
    return maxSlope;
  }

  function computeSlopeVar(slopes) {
    if (!slopes.length) return 0;
    const abs  = slopes.map(Math.abs);
    const mean = abs.reduce((s, v) => s + v, 0) / abs.length;
    const variance = slopes.reduce((s, v) => s + (v - mean) ** 2, 0) / slopes.length;
    return Math.sqrt(variance) / (1 + mean);
  }

  function computeRoughness(slopes) {
    if (slopes.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < slopes.length; i++) sum += Math.abs(slopes[i] - slopes[i - 1]);
    return sum / slopes.length;
  }

  function computeLoss(e) {
    let loss = 0;
    for (let i = 1; i < e.length; i++) if (e[i] < e[i - 1]) loss += e[i - 1] - e[i];
    return loss;
  }

  function computeAltMedia(e) {
    return e && e.length ? e.reduce((s, v) => s + v, 0) / e.length : 0;
  }

  function buildTechScore(frip, slopeVar, roughness, gain, km, surfaceLevel) {
    /* Pesi calibrati v1.0 — 96 gare / 47 GPX reali — RMSE −59%
       Aggiornare con scripts/03_calibrate.py della pipeline hub. */
    const normFRIP  = clamp(frip      / 0.924, 0, 1);  // era / 0.60
    const normSVar  = clamp(slopeVar  / 0.180, 0, 1);  // era / 0.55
    const normRough = clamp(roughness / 0.500, 0, 1);  // era / 0.051 — alzato per evitare saturazione su GPX reali
    const vertInt   = clamp((gain / km) / 74.1, 0, 1); // era / 150
    const raw = (normFRIP * 0.244 + normSVar * 0.421 + normRough * 0.208) * 0.873
              + vertInt * 0.127;
    const mult = SURFACE_MULT[surfaceLevel] || 1.00;
    return Math.round(raw * 100 * mult * 10) / 10;
  }

  function buildVolumeScore(gain, loss) {
    const Dkm  = gain / 1000;
    const Dlkm = loss / 1000;
    return (Dkm  * 10) / (1 + Math.sqrt(Dkm)  / 8)
         + (Dlkm *  4) / (1 + Math.sqrt(Dlkm)  / 6);
  }

  function buildDistFactor(km) {
    // esponente 0.48 (era 0.55) — riduce dominanza distanza sulle ultra
    const EXP = 0.48;
    const REF = Math.pow(42, EXP);
    if (km <= 100) return Math.pow(km, EXP) / REF;
    const base100 = Math.pow(100, EXP) / REF;
    const ref100  = Math.pow(100, 0.42);
    return base100 + (Math.pow(km, 0.42) - ref100) / REF * 0.6;
  }

  function buildAltFactor(altMedia) {
    return 1 + clamp((altMedia - 1300) / 10000, 0, 0.15);
  }

  function assemble(techScore, volumeScore, distFactor, altFactor,
                    frip, slopeVar, roughness, gain, loss, km,
                    surfaceLevel, estimatedTech, osmResult) {

    let finalTech = techScore;
    if (osmResult && osmResult.confidence > 0) {
      const w = 0.20 * osmResult.confidence;
      finalTech = Math.round((techScore * (1 - w) + osmResult.score * w) * 10) / 10;
    }

    const wdi  = Math.round((volumeScore + finalTech * kT) * distFactor * altFactor * 10) / 10;
    const wi   = classifyBy(wdi, WDI_THRESHOLDS);
    const ti   = classifyBy(finalTech, TECH_THRESHOLDS);
    const isVK = km < 15 && (gain / km) > 80;

    /* Normalizzazione per categoria — richiede km per determinare la fascia */
    const normResult = normalizeWDI(wdi, km);

    return {
      WDI:          wdi,           // grezzo — usato per calcoli interni
      WDI_norm:     normResult.norm,        // 0–10 per categoria distanza
      WDI_category: normResult.category,    // 'Short'|'Medium'|'Long'|'Ultra'
      WDI_legendPlus: normResult.isLegendPlus, // true se Ultra >300 grezzo
      class:     wi.level,
      color:     wi.color,
      TechScore: finalTech,        // assoluto 0–100, non categorizzato
      techClass: ti.level,
      techColor: ti.color,
      factors: {
        km, gain, loss,
        VolumeScore:   Math.round(volumeScore * 10) / 10,
        DistFactor:    Math.round(distFactor  * 100) / 100,
        AltFactor:     Math.round(altFactor   * 100) / 100,
        FRIP:          Math.round(frip        * 1000) / 1000,
        SlopeVar:      Math.round(slopeVar    * 1000) / 1000,
        Roughness:     Math.round(roughness   * 1000) / 1000,
        surfaceLevel,
        osmScore:      osmResult ? osmResult.score      : null,
        osmConfidence: osmResult ? osmResult.confidence : 0
      },
      estimatedTech,
      isVK
    };
  }

  /* ---------------------------------------------------------------
     API PUBBLICA
     --------------------------------------------------------------- */
  return {

    computeFromGpx: function (gpxPts, metrics, surfaceLevel, osmResult) {
      surfaceLevel = surfaceLevel || 3;
      osmResult    = osmResult    || null;
      const { d, e, km, gain } = metrics;
      const loss     = metrics.loss     !== undefined ? metrics.loss     : computeLoss(e);
      const altMedia = metrics.altMedia !== undefined ? metrics.altMedia : computeAltMedia(e);

      const slopes    = computeSlopes(d, e);
      const frip      = computeFRIP(d, e);
      const slopeVar  = computeSlopeVar(slopes);
      const roughness = computeRoughness(slopes);

      const techScore   = buildTechScore(frip, slopeVar, roughness, gain, km, surfaceLevel);
      const volumeScore = buildVolumeScore(gain, loss);
      const distFactor  = buildDistFactor(km);
      const altFactor   = buildAltFactor(altMedia);

      return assemble(techScore, volumeScore, distFactor, altFactor,
                      frip, slopeVar, roughness, gain, loss, km,
                      surfaceLevel, false, osmResult);
    },

    computeManual: function (opts) {
      var km = opts.km, gain = opts.gain, loss = opts.loss;
      var terrainCat = opts.terrainCat || 'EE';
      var surfaceLevel = opts.surfaceLevel || 3;
      var altMedia = opts.altMedia || 800;
      const def = TERRAIN_DEFAULTS[terrainCat] || TERRAIN_DEFAULTS['EE'];
      loss = loss || gain;

      const techScore   = buildTechScore(def.frip, def.slopeVar, def.roughness, gain, km, surfaceLevel);
      const volumeScore = buildVolumeScore(gain, loss);
      const distFactor  = buildDistFactor(km);
      const altFactor   = buildAltFactor(altMedia);

      return assemble(techScore, volumeScore, distFactor, altFactor,
                      def.frip, def.slopeVar, def.roughness, gain, loss, km,
                      surfaceLevel, true, null);
    },

    getColor:      function (wdi) { return classifyBy(wdi, WDI_THRESHOLDS).color; },
    getTechColor:  function (ts)  { return classifyBy(ts,  TECH_THRESHOLDS).color; },
    getClass:      function (wdi) { return classifyBy(wdi, WDI_THRESHOLDS).level; },
    /* Normalizzazione pubblica — usata da ranking.html e dettaglio.html */
    normalizeWDI:  normalizeWDI,
    getWdiCategory: getWdiCategory
  };

})();
