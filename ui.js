/**
 * ui.js — WizTrail UI / DOM Updates
 * Estratto da index.html nel refactoring Fase 1.
 * Dipende da: window.WizMap (per aggiornare colore traccia dopo calcolo WDI)
 * Esposto come window.WizUI = { showResults, showWDI, showError, formatTime }
 */
(function () {
  'use strict';

  /* Ritorna '#fff' o '#021' scegliendo il testo col contrasto WCAG maggiore.
     Usa luminanza relativa (IEC 61966-2-1) invece di perceived-brightness:
     la formula precedente sbagliava su Pro #34A853 → #fff = 3.1:1 (sotto AA). */
  function badgeTextColor(hex) {
    function rl(c) { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const L = 0.2126 * rl(r) + 0.7152 * rl(g) + 0.0722 * rl(b);
    return 1.05 / (L + 0.05) >= (L + 0.05) / 0.065 ? '#fff' : '#021';
  }

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
    const scoreEl    = document.getElementById('outRaceScore');
    const scoreSubEl = document.getElementById('outRaceScoreSub');
    if (!scoreEl || !scoreSubEl) return;

    /* Mostra WDI normalizzato (0–10 per categoria) come valore principale.
       Il WDI grezzo è mostrato accanto per confronto assoluto tra categorie.
       Se WDI_norm non disponibile (calcolo manuale senza km categoria) → grezzo. */
    const hasNorm = rs.WDI_norm !== undefined;
    const dispVal = hasNorm ? rs.WDI_norm.toFixed(1) : rs.WDI.toFixed(1);
    const catLabel = rs.WDI_category || '';

    scoreEl.textContent = dispVal;
    scoreEl.style.color = rs.color;

    /* Badge classe WDI */
    const badge = `<div style="
      display:inline-block; padding:4px 10px; border-radius:12px;
      font-weight:700; color:${badgeTextColor(rs.color)}; background:${rs.color}; margin-bottom:6px;
    ">${rs.WDI_legendPlus ? '🏆 Legend ∞' : wdiLabel(rs.class)}</div>`;

    /* Riga normalizzazione — visibile solo se il valore è normalizzato */
    const normRow = hasNorm ? `
      <div style="font-size:0.72rem; color:var(--muted); margin-top:2px; opacity:0.7;">
        Nella categoria ${catLabel} · WDI grezzo: ${rs.WDI.toFixed(1)}
      </div>` : '';

    scoreSubEl.innerHTML = `
      ${badge}
      ${normRow}
      <br>
      <span class="mini">WizTrail WDI v5.1 — scala per categoria distanza</span>
    `;

    // Aggiorna colore traccia sulla mappa (usa WDI grezzo — corretto)
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
    valEl.textContent = (rs.TechScore / 10).toFixed(1);
    valEl.style.color = rs.techColor;

    let note = '';
    if (rs.estimatedTech) note = '<br><span style="color:#F79617;font-size:0.75rem;">⚠ Valore stimato — carica GPX per precisione</span>';
    if (rs.isVK)          note += '<br><span style="color:#8E24AA;font-size:0.75rem;">Formato VK</span>';
    if (rs.factors && rs.factors.osmConfidence > 0) note += '<br><span style="font-size:0.75rem;opacity:0.7;">✦ Enhanced OSM: ' + Math.round(rs.factors.osmConfidence * 100) + '%</span>';

    subEl.innerHTML = '<div style="display:inline-block; padding:4px 10px; border-radius:12px;' +
      'font-weight:700; color:' + badgeTextColor(rs.techColor) + '; background:' + rs.techColor + '; margin-bottom:4px;">' +
      rs.techClass + '</div>' + note;
  }

  /* ------------------------------------------------------------------
     SHOW DISCIPLINE — mostra badge disciplina dopo il calcolo
     Richiede DisciplineClassifier (discipline-classifier.js).
     Viene chiamata da main.js dopo computeFromGpx con i dati GPX.
     Non mostrata in modalità manuale (max_altitude non disponibile).
     @param {string} discipline — 'trail'|'sky'|'mountain'|'ultra'|'xc'
     ------------------------------------------------------------------ */
  function showDiscipline(discipline) {
    const box = document.getElementById('disciplineBadgeBox');
    if (!box) return;

    if (!discipline || typeof window.DisciplineClassifier === 'undefined') {
      box.style.display = 'none';
      return;
    }

    box.innerHTML  = DisciplineClassifier.renderBadge(discipline);
    box.style.display = 'block';
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
      const baseInfo = `Punti: ${gpxPts.length}, ${metrics.km.toFixed(2)} km, D+: ${Math.round(metrics.gain)} m`;
      if (metrics.elevQuality === 'dem') {
        el.innerHTML = baseInfo +
          ` &nbsp;<span style="color:#F79617; font-weight:600;">` +
          `⚠ elevazione DEM — tecnicità potrebbe essere sottostimata</span>`;
      } else if (metrics.elevQuality === 'noisy') {
        el.innerHTML = baseInfo +
          ` &nbsp;<span style="color:var(--muted); font-size:0.85em;">` +
          `(GPS impreciso)</span>`;
      } else {
        el.textContent = baseInfo;
      }
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
  window.WizUI = { showResults, showWDI, showTechScore, showDiscipline, showError, formatTime, updateGpxInfo, initTipsToggle };

})();
