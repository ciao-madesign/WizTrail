/* ===============================================================
   WIZTRAIL ENGINE v5.0 — Unified Difficulty Model
   Sostituisce: wiztrail-racescore.js (WDI 9.1) e wiztrail-wdit.js (WDIT 7.0)
   Espone: window.WizTrail
   Caricato da: index.html (prima di main.js)

   ⚠ SOGLIE WDI — provvisorie, ricalibrate dopo test su GPX reali.
   Le soglie devono restare sincronizzate con:
     - map.js → getColorWDI()
     - ui.js → showWDI() e showTechScore()
   kT = 0.35 → peso tecnica ~32% sul totale medio
   buildTechScore: pesi calibrati v1.0 (dataset 96 gare, 47 GPX reali)
   =============================================================== */

window.WizTrail = (function () {

  const kT    = 0.35;
  const REF42 = Math.pow(42, 0.55);

  /* ---------------------------------------------------------------
     SOGLIE — ⚠ PROVVISORIE, iterare su GPX reali
     --------------------------------------------------------------- */
  const WDI_THRESHOLDS = [
    { max: 14,       level: 'Sport',    color: '#2BB7DA' },
    { max: 30,       level: 'Pro',      color: '#34A853' },
    { max: 55,       level: 'Advanced', color: '#F4C20D' },
    { max: 105,      level: 'Extreme',  color: '#F79617' },
    { max: 165,      level: 'Elite',    color: '#E91E63' },
    { max: Infinity, level: 'Legend',   color: '#8E24AA' }
  ];

  const TECH_THRESHOLDS = [
    { max: 15,       level: 'Facile',        color: '#2BB7DA' },
    { max: 28,       level: 'Moderato',      color: '#34A853' },
    { max: 42,       level: 'Tecnico',       color: '#F4C20D' },
    { max: 58,       level: 'Molto tecnico', color: '#F79617' },
    { max: 72,       level: 'Alpinistico',   color: '#E91E63' },
    { max: Infinity, level: 'Estremo',       color: '#8E24AA' }
  ];

  const SURFACE_MULT = { 1: 0.92, 2: 0.97, 3: 1.00, 4: 1.04, 5: 1.08 };

  const TERRAIN_DEFAULTS = {
    'E':  { frip: 0.10, slopeVar: 0.12, roughness: 0.06 },
    'EE': { frip: 0.18, slopeVar: 0.20, roughness: 0.12 },
    'EA': { frip: 0.28, slopeVar: 0.30, roughness: 0.20 }
  };

  /* ---------------------------------------------------------------
     FUNZIONI PRIVATE
     --------------------------------------------------------------- */
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

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
    /* ---------------------------------------------------------------
       Pesi calibrati v1.0 — dataset 96 gare / 47 GPX reali
       Algoritmo: Differential Evolution, seed=42, maxiter=500
       RMSE prima: 32.99 → dopo: 13.51  (–59%)
       Aggiornare eseguendo scripts/03_calibrate.py nella pipeline
       di autotraining.
       --------------------------------------------------------------- */
    const normFRIP  = clamp(frip      / 0.924, 0, 1);  // era / 0.60
    const normSVar  = clamp(slopeVar  / 0.180, 0, 1);  // era / 0.55
    const normRough = clamp(roughness / 0.051, 0, 1);  // era / 0.35
    const vertInt   = clamp((gain / km) / 74.1, 0, 1); // era / 150
    const raw = (normFRIP * 0.244 + normSVar * 0.421 + normRough * 0.208) * 0.873
              + vertInt * 0.127;                        // era * 0.30
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
    if (km <= 100) return Math.pow(km, 0.55) / REF42;
    const base100 = Math.pow(100, 0.55) / REF42;
    const ref100  = Math.pow(100, 0.42);
    return base100 + (Math.pow(km, 0.42) - ref100) / REF42 * 0.6;
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

    return {
      WDI:       wdi,
      class:     wi.level,
      color:     wi.color,
      TechScore: finalTech,
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

    getColor:     function (wdi) { return classifyBy(wdi, WDI_THRESHOLDS).color; },
    getTechColor: function (ts)  { return classifyBy(ts,  TECH_THRESHOLDS).color; },
    getClass:     function (wdi) { return classifyBy(wdi, WDI_THRESHOLDS).level; }
  };

})();
