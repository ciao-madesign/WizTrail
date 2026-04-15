/**
 * ui.js — WizTrail UI / DOM Updates
 * Estratto da index.html nel refactoring Fase 1.
 * Dipende da: window.WizMap (per aggiornare colore traccia dopo calcolo WDI)
 * Esposto come window.WizUI = { showResults, showWDI, showError, formatTime }
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     HELPERS
     ------------------------------------------------------------------ */

  /**
   * Formatta secondi → "h:mm:ss"
   */
  function formatTime(totalSeconds) {
    const s = Math.round(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const se = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(se).padStart(2, '0')}`;
  }

  /**
   * Etichetta leggibile per la classe WDI
   */
  function wdiLabel(cls) {
    const labels = { Sport: 'Sport', Pro: 'Pro', Advanced: 'Advanced',
                     Extreme: 'Extreme', Elite: 'Elite', Legend: 'Legend' };
    return labels[cls] || cls;
  }

  /* ------------------------------------------------------------------
     SHOW RESULTS — aggiorna KPI tempo nel tab Calcolatore
     @param {number} T       — tempo totale in secondi
     @param {number} margin  — margine in decimale (es. 0.10)
     ------------------------------------------------------------------ */
  function showResults(T, margin) {
    const el = id => document.getElementById(id);
    el('outFinal').textContent = formatTime(T);
    el('outLow').textContent   = formatTime(T * (1 - margin));
    el('outHigh').textContent  = formatTime(T * (1 + margin));
  }

  /* ------------------------------------------------------------------
     SHOW WDI — aggiorna la card WDI con punteggio, classe e colore
     @param {object} rs  — oggetto restituito da WizTrail.computeFromGpx()
                           { WDI, class, color }
     ------------------------------------------------------------------ */
  function showWDI(rs) {
    const scoreEl  = document.getElementById('outRaceScore');
    const scoreSubEl = document.getElementById('outRaceScoreSub');
    if (!scoreEl || !scoreSubEl) return;

    scoreEl.textContent = rs.WDI.toFixed(1);
    scoreEl.style.color = rs.color;

    scoreSubEl.innerHTML = `
      <div style="
        display:inline-block;
        padding:4px 10px;
        border-radius:12px;
        font-weight:700;
        color:#021;
        background:${rs.color};
        margin-bottom:8px;
      ">${wdiLabel(rs.class)}</div>
      <br><br>
      <span class="mini">Difficoltà stimata con WizTrail WDI v5.0</span>
    `;

    // Aggiorna colore traccia sulla mappa
    if (window.WizMap) window.WizMap.drawTrack();

    // Aggiorna TechScore se disponibile
    if (rs.TechScore !== undefined) showTechScore(rs);
  }

  /* ------------------------------------------------------------------
     SHOW TECHSCORE — aggiorna la card TechScore
     ------------------------------------------------------------------ */
  function showTechScore(rs) {
    const box   = document.getElementById('techScoreBox');
    const valEl = document.getElementById('outTechScore');
    const subEl = document.getElementById('outTechScoreSub');
    if (!box || !valEl || !subEl) return;

    box.style.display = 'block';
    valEl.textContent = rs.TechScore.toFixed(1);
    valEl.style.color = rs.techColor;

    let note = '';
    if (rs.estimatedTech) note = '<br><span style="color:#F79617;font-size:0.75rem;">⚠ Valore stimato — carica GPX per precisione</span>';
    if (rs.isVK)          note += '<br><span style="color:#8E24AA;font-size:0.75rem;">Formato VK</span>';
    if (rs.factors && rs.factors.osmConfidence > 0) note += '<br><span style="font-size:0.75rem;opacity:0.7;">✦ Enhanced OSM: ' + Math.round(rs.factors.osmConfidence * 100) + '%</span>';

    subEl.innerHTML = '<div style="display:inline-block; padding:4px 10px; border-radius:12px;' +
      'font-weight:700; color:#021; background:' + rs.techColor + '; margin-bottom:4px;">' +
      rs.techClass + '</div>' + note;
  }

  /* ------------------------------------------------------------------
     SHOW ERROR — messaggio nell'elemento #msg
     ------------------------------------------------------------------ */
  function showError(msg) {
    const el = document.getElementById('msg');
    if (el) el.textContent = msg;
  }

  /* ------------------------------------------------------------------
     UPDATE GPX INFO — mostra info traccia caricata
     ------------------------------------------------------------------ */
  function updateGpxInfo(gpxPts, metrics) {
    const el = document.getElementById('gpxInfo');
    if (!el) return;

    // Rileva se il GPX manca di dati elevazione
    const hasElevation = metrics.gain > 0 ||
      (metrics.e && metrics.e.some(v => v !== 0));

    if (hasElevation) {
      el.textContent =
        `Punti: ${gpxPts.length}, ${metrics.km.toFixed(2)} km, D+: ${Math.round(metrics.gain)} m`;
    } else {
      el.innerHTML =
        `Punti: ${gpxPts.length}, ${metrics.km.toFixed(2)} km &nbsp;` +
        `<span style="color:#F79617; font-weight:600;">` +
        `⚠ GPX senza dati altimetrici — inserisci D+ manualmente</span>`;
    }

    // Pre-riempie distanza sempre (viene dal GPS, è affidabile)
    const distEl = document.getElementById('dist');
    if (distEl) distEl.value = metrics.km.toFixed(3);

    // Pre-riempie D+ solo se il GPX ha dati elevazione
    // Se manca, lascia il valore che l'utente ha già inserito (o il default)
    const dplusEl = document.getElementById('dplus');
    if (dplusEl && hasElevation) {
      dplusEl.value = Math.round(metrics.gain);
    }
  }

  /* ------------------------------------------------------------------
     SHOW TIPS TOGGLE — logica collassa/espandi suggerimenti
     ------------------------------------------------------------------ */
  function initTipsToggle() {
    const header = document.getElementById('calc_tips_header');
    const body   = document.getElementById('calc_tips_body');
    const toggle = document.getElementById('calc_tips_toggle');
    if (!header || !body || !toggle) return;

    header.addEventListener('click', () => {
      const isVisible = body.style.display !== 'none';
      body.style.display   = isVisible ? 'none' : 'block';
      toggle.textContent   = isVisible ? 'Mostra suggerimenti' : 'Nascondi suggerimenti';
    });
  }

  /* ------------------------------------------------------------------
     Esposizione globale
     ------------------------------------------------------------------ */
  window.WizUI = { showResults, showWDI, showTechScore, showError, formatTime, updateGpxInfo, initTipsToggle };

})();
