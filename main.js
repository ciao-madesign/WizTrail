/**
 * main.js — WizTrail Entry Point
 * Estratto da index.html nel refactoring Fase 1.
 *
 * Dipende (caricati prima in index.html):
 *   - Leaflet
 *   - wiztrail-engine.js     → window.WizTrail
 *   - wiztrail-pacing.js     → window.WizTrailPacing / funzioni pacing
 *   - wiztrail-postgara.js   → window.WizTrailPostgara
 *   - wiztrail-report.js     → window.WizTrailReport
 *   - gpx-parser.js          → window.GPXParser
 *   - map.js                 → window.WizMap
 *   - ui.js                  → window.WizUI
 *
 * Stato globale esposto su window per compatibilità con i moduli esistenti:
 *   window.gpxPts, window.metrics, window.currentWDI, window.lastRS
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     STATO GLOBALE
     ------------------------------------------------------------------ */
  window.gpxPts            = [];
  window.metrics           = { e: [], d: [] };
  window.currentWDI        = null;
  window.lastRS            = null;
  window.currentSurfaceLevel = 3;
  window.lastOsmResult       = null;

  /* ------------------------------------------------------------------
     HELPERS — lettura input numerici
     Esposta su window per compatibilità con wiztrail-pacing.js
     ------------------------------------------------------------------ */
  function readNum(id) {
    return parseFloat(
      (document.getElementById(id)?.value || '0').replace(',', '.')
    ) || 0;
  }
  window.readNum = readNum;

  /* ------------------------------------------------------------------
     TEMA
     ------------------------------------------------------------------ */
  document.getElementById('themeSel')?.addEventListener('change', e => {
    document.body.setAttribute('data-theme', e.target.value);
  });

  /* ------------------------------------------------------------------
     TAB SWITCHING
     ------------------------------------------------------------------ */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => {
        p.classList.remove('active');
      });
      btn.classList.add('active');
      const panel = document.getElementById(btn.dataset.tab);
      if (panel) {
        // Force reflow per riattivare animazione CSS
        void panel.offsetWidth;
        panel.classList.add('active', 'tab-animated');
      }

      // Mappa 2D: inizializza e ridisegna
      if (btn.dataset.tab === 'map2d') {
        WizMap.init();
        setTimeout(() => {
          WizMap.drawTrack();
          WizMap.drawProfile();
          WizMap.fitTrack();
        }, 120);
      }

      // Pacing: avviso se manca GPX
      if (btn.dataset.tab === 'pacing') {
        const warn = document.getElementById('pc_warning');
        if (warn) warn.style.display =
          (!window.gpxPts || !window.gpxPts.length) ? 'block' : 'none';
      }
    });
  });

  /* ------------------------------------------------------------------
     CARICAMENTO GPX / TCX
     ------------------------------------------------------------------ */
  document.getElementById('gpxfile')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;

    const txt = await f.text();
    const xml = new DOMParser().parseFromString(txt, 'application/xml');

    window.gpxPts  = GPXParser.parseTrack(xml);
    window.metrics = GPXParser.compute(window.gpxPts);

    WizUI.updateGpxInfo(window.gpxPts, window.metrics);
    WizMap.drawTrack();
    WizMap.drawProfile();
  });

  /* ------------------------------------------------------------------
     PULSANTE "Centra sulla traccia"
     ------------------------------------------------------------------ */
  document.getElementById('btnFit')?.addEventListener('click', () => WizMap.fitTrack());

  /* ------------------------------------------------------------------
     EXPORT KML
     ------------------------------------------------------------------ */
  document.getElementById('btnKml')?.addEventListener('click', () => {
    if (!window.gpxPts.length) { alert('Carica prima un GPX'); return; }

    const coords = window.gpxPts.map(p => `${p[1]},${p[0]},${p[2]}`).join(' ');
    const kml    = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><n>Percorso</n>
<LineString><coordinates>${coords}</coordinates></LineString>
</Placemark></Document></kml>`;

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'wiztrail.kml';
    a.click();
  });

  /* ------------------------------------------------------------------
     ENGINE TIME ESTIMATOR v2.0
     ------------------------------------------------------------------ */

  function velocityFromSlope(p, S, velBase) {
    if (Math.abs(p) < 0.015) return velBase;

    if (p > 0) {
      let fatt = 1 + 3.5 * p;
      fatt *= (1 + (1 - S));
      if (fatt > 2.0) fatt = 2.0;
      return velBase / fatt;
    }

    if (p < 0 && p > -0.10) {
      let fatt = 1 - 0.5 * Math.abs(p);
      if (fatt < 0.85) fatt = 0.85;
      return velBase / fatt;
    }

    // Discesa ripida
    return velBase / (1 + Math.abs(p));
  }

  function technicalPenalty(slope, terrainClass) {
    if (terrainClass === 'E')   return 0;
    if (terrainClass === 'EE' && (slope > 0.08 || slope < -0.10)) return 0.12;
    if (terrainClass === 'EA' && (slope > 0.08 || slope < -0.10)) return 0.28;
    return 0;
  }

  function fatigueFactor(t_hours) {
    return 1 + Math.pow(t_hours / 12, 1.3);
  }

  /* ------------------------------------------------------------------
     BOTTONE CALCOLA
     ------------------------------------------------------------------ */
  document.getElementById('calcBtn')?.addEventListener('click', () => {
    WizUI.showError('');

    // Validazione input 10K
    const t10 = document.getElementById('t10k')?.value || '';
    if (!/^[0-9]+:[0-5][0-9]$/.test(t10)) {
      WizUI.showError('Formato 10K non valido');
      return;
    }

    if (!window.gpxPts || !window.gpxPts.length) {
      WizUI.showError('Carica un GPX per usare il modello v2.0');
      return;
    }

    const [min10, sec10] = t10.split(':').map(Number);
    const m10     = min10 + sec10 / 60;
    const velBase = 60 / (m10 / 10); // km/h

    const terrainClass = document.getElementById('terrain')?.value || 'E';
    const S      = readNum('spec');
    const meteo  = readNum('meteo');
    const alt    = readNum('alt');
    const margin = readNum('margin') / 100;

    // Calcola metrics dal GPX per coordinate e profilo altimetrico
    const mGpx = GPXParser.compute(window.gpxPts);

    // Leggi distanza e D+ dai campi form — l'utente può averli corretti manualmente
    const manualKm   = readNum('dist');
    const manualGain = readNum('dplus');

    // Costruisce metrics ibrido: coordinate dal GPX, valori numerici dal form
    // Questo permette di usare un GPX senza elevazione correggendo D+ a mano
    const m = {
      ...mGpx,
      km:   manualKm   > 0 ? manualKm   : mGpx.km,
      gain: manualGain > 0 ? manualGain : mGpx.gain,
      loss: manualGain > 0 ? manualGain : mGpx.gain, // stima loss = gain se non disponibile
    };

    const elev_s  = GPXParser.smoothElevation(m.e);
    const segments = GPXParser.computeSegments(window.gpxPts, m.d, elev_s);

    let T = 0;
    segments.forEach(seg => {
      const velLocal  = velocityFromSlope(seg.slope, S, velBase);
      const tech      = technicalPenalty(seg.slope, terrainClass);
      const velTech   = velLocal / (1 + tech);
      const t_raw     = seg.dist / (velTech * 1000 / 3600);
      const fat       = fatigueFactor(T / 3600);
      T += t_raw * fat;
    });

    // Se il GPX non ha elevazione, stima il tempo dal D+ manuale
    // (segments avranno tutti slope=0, quindi T sarà solo da velocità base)
    // Aggiungiamo una correzione proporzionale al D+ manuale
    if (mGpx.gain === 0 && manualGain > 0) {
      // Stima tempo aggiuntivo per il dislivello: ~1 min ogni 8m D+
      const extraSec = (manualGain / 8) * 60;
      T += extraSec;
    }

    // Fattori meteo / altitudine
    const T_hours = T / 3600;
    T *= 1 + (meteo - 1) * (T_hours / 5);
    T *= alt;

    // WDI — usa metrics ibrido con D+ manuale
    const rs = WizTrail.computeFromGpx(
      window.gpxPts,
      m,
      window.currentSurfaceLevel,
      window.lastOsmResult
    );
    window.currentWDI = rs.WDI;
    window.lastRS     = rs;

    WizUI.showWDI(rs);
    WizUI.showResults(T, margin);
    WizUI.showError('OK');

    // Microinterazione: KPI reveal animation
    document.querySelectorAll('.kpi-primary').forEach(el => {
      el.classList.remove('kpi-animate');
      // Force reflow per riattivare l'animazione
      void el.offsetWidth;
      el.classList.add('kpi-animate');
    });
  });

  /* ------------------------------------------------------------------
     RESET
     ------------------------------------------------------------------ */
  document.getElementById('resetBtn')?.addEventListener('click', () => location.reload());

  /* ------------------------------------------------------------------
     EXPORT JSON (snapshot pre-gara)
     ------------------------------------------------------------------ */
  document.getElementById('btnFotoJson')?.addEventListener('click', () => {
    const g = id => document.getElementById(id)?.textContent || null;
    const v = id => document.getElementById(id)?.value || null;

    const snapshot = {
      timestamp:   new Date().toISOString(),
      distance_km: v('dist'),
      d_plus_m:    v('dplus'),
      t10k:        v('t10k'),
      condizioni: {
        meteo:  v('meteo'),
        alt:    v('alt'),
        fatica: v('fatica'),
        spec:   v('spec'),
        margin: v('margin'),
      },
      risultato: {
        tempo_finale: g('outFinal'),
        low:          g('outLow'),
        high:         g('outHigh'),
        WDI:          window.lastRS ? window.lastRS.WDI.toFixed(1)      : null,
        WDI_class:    window.lastRS ? window.lastRS.class                : null,
        WDI_color:    window.lastRS ? window.lastRS.color                : null,
        TechScore:    window.lastRS ? window.lastRS.TechScore.toFixed(1) : null,
        techClass:    window.lastRS ? window.lastRS.techClass            : null,
        techColor:    window.lastRS ? window.lastRS.techColor            : null,
      },
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'wiztrail-riepilogo.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ------------------------------------------------------------------
     PWA — Service Worker
     ------------------------------------------------------------------ */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js');
  }

  /* ------------------------------------------------------------------
     PWA — Banner iOS
     ------------------------------------------------------------------ */
  (function () {
    const STORAGE_KEY = 'wiztrail_ios_banner_closed_v1';
    if (localStorage.getItem(STORAGE_KEY) === '1') return;

    const ua         = window.navigator.userAgent || '';
    const isIOS      = /iP(hone|od|ad)/i.test(ua);
    const isWebkit   = /WebKit/i.test(ua);
    const isSafari   = isIOS && isWebkit &&
                       !/CriOS|FxiOS|OPiOS|SamsungBrowser/i.test(ua);
    const isStandalone = window.navigator.standalone === true ||
                         window.matchMedia?.('(display-mode: standalone)').matches;

    if (isSafari && !isStandalone) {
      const el       = document.getElementById('installIos');
      const closeBtn = document.getElementById('installIosClose');
      if (el && closeBtn) {
        el.style.display = 'block';
        closeBtn.addEventListener('click', () => {
          el.style.display = 'none';
          localStorage.setItem(STORAGE_KEY, '1');
        }, { once: true });
      }
    }
  })();

  /* ------------------------------------------------------------------
     INIT UI opzionale
     ------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    WizUI.initTipsToggle();
  });

  /* ------------------------------------------------------------------
     SLIDER SUPERFICIE
     ------------------------------------------------------------------ */
  document.getElementById('surfaceSlider')?.addEventListener('input', function () {
    window.currentSurfaceLevel = parseInt(this.value) || 3;
    if (window.gpxPts && window.gpxPts.length && window.metrics) {
      const rs = WizTrail.computeFromGpx(
        window.gpxPts, window.metrics,
        window.currentSurfaceLevel, window.lastOsmResult
      );
      window.currentWDI = rs.WDI;
      window.lastRS     = rs;
      WizUI.showWDI(rs);
      WizUI.showTechScore(rs);
    }
  });

  // wiztrail-osm.js disabilitato: OSM Enhanced rimosso (0% copertura Overpass API).
  // Da ripristinare con proxy serverless + CORINE (vedi task Notion).

  /* ------------------------------------------------------------------
     ACCORDION PARAMETRI AVANZATI
     ------------------------------------------------------------------ */
  const advToggle = document.getElementById('advToggle');
  const advBody   = document.getElementById('advBody');
  if (advToggle && advBody) {
    advToggle.addEventListener('click', function () {
      const open = advBody.classList.toggle('open');
      advToggle.classList.toggle('open', open);
      advToggle.setAttribute('aria-expanded', open);
    });
  }

  /* ------------------------------------------------------------------
     GPX EMPTY STATE — mostra messaggio se nessun GPX caricato
     ------------------------------------------------------------------ */
  const gpxEmpty = document.getElementById('gpxEmpty');
  const gpxInfo  = document.getElementById('gpxInfo');
  if (gpxEmpty && gpxInfo) {
    // Mostra empty state inizialmente
    gpxEmpty.style.display = 'flex';
    // Nasconde quando GPX caricato
    document.getElementById('gpxfile')?.addEventListener('change', function (e) {
      if (e.target.files && e.target.files.length > 0) {
        gpxEmpty.style.display = 'none';
      } else {
        gpxEmpty.style.display = 'flex';
      }
    });
  }

})();
