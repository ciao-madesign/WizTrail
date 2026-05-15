/**
 * discipline-classifier.js — WizTrail Discipline Classifier
 * Classifica automaticamente una gara/attività in:
 *   trail | sky | mountain | ultra | xc
 *
 * Modulo puro: nessuna dipendenza da DOM o altri moduli WizTrail.
 * Esposto come window.DisciplineClassifier = { classify, BADGES }
 *
 * Input richiesto:
 *   { distance_km, dplus, max_altitude, wdi }
 *   (tutti disponibili da GPXParser.compute() + WizTrail.computeFromGpx())
 *
 * Soglie calibrate su 31 gare reali (25 con max_altitude da GPX). Estendere con sky/xc per fase 2.
 *
 * Logica di classificazione (in ordine di priorità):
 *   ULTRA    → distanza ≥ 95km (indipendente da tecnicità)
 *   SKY      → quota >2000m E (D+/km >100 O WDI alto)
 *   MOUNTAIN → D+/km >80 E quota >1200m (senza i requisiti sky)
 *   XC       → distanza <=12km E D+ <200m (gara pianeggiante)
 *   TRAIL    → default
 */

window.DisciplineClassifier = (function () {
  'use strict';

  /* ------------------------------------------------------------------
     BADGE — label, colore e emoji per disciplina
     ------------------------------------------------------------------ */
  const BADGES = {
    trail:    { label: 'Trail',    color: '#2d9e6a', bg: '#2d9e6a22', emoji: '🌲' },
    sky:      { label: 'Sky',      color: '#e05c5c', bg: '#e05c5c22', emoji: '⛰️'  },
    mountain: { label: 'Mountain', color: '#6b9ec8', bg: '#6b9ec822', emoji: '🏔️'  },
    ultra:    { label: 'Ultra',    color: '#8E24AA', bg: '#8E24AA22', emoji: '🔥'  },
    xc:       { label: 'XC',       color: '#e9a800', bg: '#e9a80022', emoji: '🏅'  },
  };

  /* ------------------------------------------------------------------
     CLASSIFY — classifica disciplina da metriche gara
     @param {object} opts
     @param {number} opts.distance_km   — distanza totale in km
     @param {number} opts.dplus         — dislivello positivo in metri
     @param {number} [opts.max_altitude=0] — quota massima in metri
     @param {number} [opts.wdi=0]       — WDI calcolato (riservato per usi futuri)
     @returns {'trail'|'sky'|'mountain'|'xc'}
     ------------------------------------------------------------------ */
  function classify(opts) {
    const km           = opts.distance_km || 0;
    const dplus        = opts.dplus        || 0;
    const max_altitude = opts.max_altitude || 0;
    const wdi          = opts.wdi          || 0;

    if (km === 0) return 'trail'; // fallback sicuro

    const avg_gain_per_km = dplus / km;

    // — ULTRA —
    // Distanza ≥ 95km, indipendente da tecnicità o quota.
    // Distingue le grandi traversate (UTMB, TOR, Hardrock) dal trail classico.
    // Soglia 95km scelta per includere Black Canyon 100M (95km) ed escludere VUT90 (89km).
    if (km >= 95) {
      return 'ultra';
    }

    // — SKYRUNNING —
    // Alta quota + pendenza estrema. WDI escluso: correla con difficoltà generale,
    // non con skyrunning (falsi positivi su trail duri ad alta quota).
    if (
      max_altitude > 2000 &&
      avg_gain_per_km > 100
    ) {
      return 'sky';
    }

    // — MOUNTAIN RUNNING —
    // Dislivello importante + quota media-alta, senza raggiungere sky.
    if (
      avg_gain_per_km > 80 &&
      max_altitude > 1200
    ) {
      return 'mountain';
    }

    // — CROSS COUNTRY —
    // Gara breve e pianeggiante.
    if (
      km <= 12 &&
      dplus < 200
    ) {
      return 'xc';
    }

    // — TRAIL (default) —
    return 'trail';
  }

  /* ------------------------------------------------------------------
     RENDER BADGE — restituisce HTML string del badge disciplina
     @param {string} discipline — chiave disciplina
     @returns {string} HTML
     ------------------------------------------------------------------ */
  function renderBadge(discipline) {
    const b = BADGES[discipline] || BADGES.trail;
    return `<span class="discipline-badge" style="
      display:inline-block;
      padding:2px 9px;
      border-radius:20px;
      font-size:0.72rem;
      font-weight:700;
      letter-spacing:0.04em;
      color:${b.color};
      background:${b.bg};
      border:1px solid ${b.color}44;
      vertical-align:middle;
    ">${b.emoji} ${b.label}</span>`;
  }

  /* ------------------------------------------------------------------
     Esposizione globale
     ------------------------------------------------------------------ */
  return { classify, renderBadge, BADGES };

})();
