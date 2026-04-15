/**
 * discipline-classifier.js — WizTrail Discipline Classifier
 * Classifica automaticamente una gara/attività in:
 *   trail | sky | mountain | xc
 *
 * Modulo puro: nessuna dipendenza da DOM o altri moduli WizTrail.
 * Esposto come window.DisciplineClassifier = { classify, BADGES }
 *
 * Input richiesto:
 *   { distance_km, dplus, max_altitude, wdi }
 *   (tutti disponibili da GPXParser.compute() + WizTrail.computeFromGpx())
 *
 * ⚠ Soglie PROVVISORIE — ricalibrate dopo dataset ITRA completo (B1-B3).
 *
 * Logica di classificazione (in ordine di priorità):
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
    trail:    { label: 'Trail',    color: '#2d6a4f', bg: '#2d6a4f22', emoji: '🌲' },
    sky:      { label: 'Sky',      color: '#c1121f', bg: '#c1121f22', emoji: '⛰️'  },
    mountain: { label: 'Mountain', color: '#1d3557', bg: '#1d355722', emoji: '🏔️'  },
    xc:       { label: 'XC',       color: '#e9a800', bg: '#e9a80022', emoji: '🏅'  },
  };

  /* ------------------------------------------------------------------
     CLASSIFY — classifica disciplina da metriche gara
     @param {object} opts
     @param {number} opts.distance_km   — distanza totale in km
     @param {number} opts.dplus         — dislivello positivo in metri
     @param {number} [opts.max_altitude=0] — quota massima in metri
     @param {number} [opts.wdi=0]       — WDI calcolato (opzionale, raffina sky)
     @returns {'trail'|'sky'|'mountain'|'xc'}
     ------------------------------------------------------------------ */
  function classify(opts) {
    const km           = opts.distance_km || 0;
    const dplus        = opts.dplus        || 0;
    const max_altitude = opts.max_altitude || 0;
    const wdi          = opts.wdi          || 0;

    if (km === 0) return 'trail'; // fallback sicuro

    const avg_gain_per_km = dplus / km;

    // — SKYRUNNING —
    // Alta quota + pendenza estrema o WDI elevato
    if (
      max_altitude > 2000 &&
      (avg_gain_per_km > 100 || wdi > 80)
    ) {
      return 'sky';
    }

    // — MOUNTAIN RUNNING —
    // Dislivello importante + quota media-alta, senza raggiungere sky
    if (
      avg_gain_per_km > 80 &&
      max_altitude > 1200
    ) {
      return 'mountain';
    }

    // — CROSS COUNTRY —
    // Gara breve e pianeggiante
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
