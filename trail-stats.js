/**
 * trail-stats.js — Statistiche dettagliate del percorso
 *
 * Espone: window.TrailStats
 * API:    TrailStats.compute(pts, metrics, engineResult) → oggetto stats
 *
 * Dipende da: gpx-parser.js (GPXParser) — deve essere caricato prima.
 *
 * Principio chiave: NON ricalcola mai ciò che l'engine ha già prodotto.
 * I valori engineResult.factors.{Roughness, SlopeVar, FRIP, loss} vengono
 * passati direttamente nell'output senza rielaborazione.
 *
 * Input:
 *   pts          — [[lat, lon, ele], ...] da GPXParser.parseTrack()
 *   metrics      — {km, gain, e[], d[], max_altitude} da GPXParser.compute()
 *   engineResult — risultato di WizTrail.computeFromGpx() o computeManual()
 *
 * Output: oggetto piatto con tutte le statistiche (documentato per gruppo).
 */
window.TrailStats = (function () {
  'use strict';

  /* ------------------------------------------------------------------
     COSTANTI
     ------------------------------------------------------------------ */

  // Soglia pendenza per distinguere salita / piano / discesa (2%).
  // Calibrata su tracce reali: sotto il 2% il GPS introduce troppo rumore
  // per classificare l'intenzione come "salita" o "discesa".
  const SLOPE_FLAT = 0.02;

  /* ------------------------------------------------------------------
     SOGLIE SALITE SIGNIFICATIVE (adattive per distanza)
     Una salita conta solo se supera entrambe le soglie contemporaneamente:
     distanza orizzontale continua E dislivello accumulato.
     Percorsi corti → soglie più basse per catturare tutti i muri.
     Percorsi lunghi → soglie più alte per evitare frammentazione eccessiva.
     ------------------------------------------------------------------ */
  function climbThresholds(km) {
    return km < 50
      ? { minHorizM: 300, minGainM: 30 }
      : { minHorizM: 500, minGainM: 50 };
  }

  /* ------------------------------------------------------------------
     ALTIMETRIA
     ------------------------------------------------------------------ */
  function computeAlt(pts, metrics) {
    const elev = metrics.e.filter(Number.isFinite);
    if (!elev.length) {
      return { alt_min: 0, alt_mean: 0, alt_max: 0, alt_start: 0, alt_end: 0 };
    }
    return {
      alt_min:   Math.round(Math.min(...elev)),
      alt_max:   Math.round(metrics.max_altitude || Math.max(...elev)),
      alt_mean:  Math.round(elev.reduce((a, b) => a + b, 0) / elev.length),
      // quota di partenza e arrivo — dal tracciato grezzo (prima del smoothing)
      alt_start: Number.isFinite(pts[0]?.[2])              ? Math.round(pts[0][2])              : Math.round(elev[0]),
      alt_end:   Number.isFinite(pts[pts.length - 1]?.[2]) ? Math.round(pts[pts.length - 1][2]) : Math.round(elev[elev.length - 1]),
    };
  }

  /* ------------------------------------------------------------------
     PENDENZE
     Usa GPXParser.computeSegments(segLength=80m) che già clampa le pendenze
     impossibili (spike GPS > 35%). Le medie sono pesate sulla distanza del
     segmento per non dare lo stesso peso a un segmento da 80m e uno da 800m.
     ------------------------------------------------------------------ */
  function computeSlopes(pts, metrics) {
    const segs = GPXParser.computeSegments(pts, metrics.d, metrics.e, 80);
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
      const s = seg.slope;  // già clampato da computeSegments
      const d = seg.dist;
      totalDist += d;

      if (s > SLOPE_FLAT) {
        upDistW += d;
        upSum   += s * d;          // media pesata per distanza
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
      // Pendenze in % (moltiplico per 100 il ratio, arrotondo a 1 decimale)
      slope_up_avg:   upDistW   > 0 ? Math.round(upSum   / upDistW   * 1000) / 10 : 0,
      slope_up_max:   Math.round(upMax   * 1000) / 10,
      slope_down_avg: downDistW > 0 ? Math.round(downSum / downDistW * 1000) / 10 : 0,
      slope_down_max: Math.round(downMax * 1000) / 10,
      // Percentuali di distanza (somma = 100% salvo arrotondamenti)
      pct_uphill:   Math.round(upDistW   / T * 100),
      pct_flat:     Math.round(flatDist  / T * 100),
      pct_downhill: Math.round(downDistW / T * 100),
    };
  }

  /* ------------------------------------------------------------------
     STRUTTURA: salite e discese significative
     Algoritmo run-length encoding sui segmenti:
     - Accumula segmenti consecutivi nella stessa direzione
     - Un tratto pianeggiante breve (<200m) viene "assorbito" nel run corrente
       per non spezzare artificialmente una lunga salita con qualche metro flat
     - Quando la direzione cambia (o un tratto flat >200m interrompe), valida
       il run: se supera entrambe le soglie → conta salita/discesa
     ------------------------------------------------------------------ */
  function computeClimbs(pts, metrics) {
    const { minHorizM, minGainM } = climbThresholds(metrics.km);
    const segs = GPXParser.computeSegments(pts, metrics.d, metrics.e, 80);

    let climbs = 0, descents = 0;
    let bestClimbKm = 0, bestClimbGain = 0;

    let runDir  = 0;   // 1 = salita, -1 = discesa, 0 = non iniziato
    let runDist = 0;
    let runGain = 0;

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
        // Tratto piano: se corto, assorbilo nel run corrente senza interrompere;
        // se lungo (>200m), è una vera interruzione → chiudi il run.
        if (seg.dist > 200) {
          flushRun();
        } else if (runDir !== 0) {
          runDist += seg.dist;
        }
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
    flushRun(); // non dimenticare l'ultimo run aperto

    return {
      climbs_count:       climbs,
      descents_count:     descents,
      longest_climb_km:   Math.round(bestClimbKm   * 10) / 10,
      longest_climb_gain: Math.round(bestClimbGain),
    };
  }

  /* ------------------------------------------------------------------
     TRAIL EFFICIENCY INDEX
     Rapporto distanza in linea retta (start → end) / distanza totale.
     1.0 = percorso rettilineo puro (impossibile in pratica).
     ~0.1 = ad anello o molto tortuoso.
     GPXParser.hav() restituisce la distanza in METRI.
     ------------------------------------------------------------------ */
  function computeEfficiency(pts, km) {
    if (!pts || pts.length < 2 || km <= 0) return 0;
    const last = pts.length - 1;
    const straightM = GPXParser.hav(pts[0][0], pts[0][1], pts[last][0], pts[last][1]);
    return Math.round(straightM / (km * 1000) * 100) / 100;
  }

  /* ------------------------------------------------------------------
     API PUBBLICA
     ------------------------------------------------------------------ */
  function compute(pts, metrics, engineResult) {
    if (!pts || pts.length < 2 || !metrics || !engineResult) return null;

    const f = engineResult.factors;  // alias per leggibilità — dati già calcolati dall'engine

    return {
      // --- Altimetria ---
      ...computeAlt(pts, metrics),
      gain: Math.round(metrics.gain),     // D+ — già calcolato da GPXParser.compute()
      loss: Math.round(f.loss || 0),       // D- — già calcolato da wiztrail-engine.js

      // --- Pendenze ---
      ...computeSlopes(pts, metrics),

      // --- Struttura ---
      ...computeClimbs(pts, metrics),
      trail_efficiency: computeEfficiency(pts, metrics.km),

      // --- Tecnico: riuso diretto dall'engine, non ricalcolati ---
      roughness:    f.Roughness,
      slope_var:    f.SlopeVar,
      frip:         f.FRIP,
      // tech_density = TechScore per km — misura l'intensità tecnica per unità di distanza
      tech_density: metrics.km > 0
        ? Math.round(engineResult.TechScore / metrics.km * 10) / 10
        : 0,
    };
  }

  return { compute };

})();
