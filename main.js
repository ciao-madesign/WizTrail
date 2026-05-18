/**
 * main.js — WizTrail Entry Point
 * Estratto da index.html nel refactoring Fase 1.
 *
 * Dipende (caricati prima in index.html):
 *   - Leaflet
 *   - wiztrail-engine.js     → window.WizTrail
 *   - wiztrail-pacing.js     → window.WizTrailPacing / funzioni pacing
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
  window.currentWDI        = null;   // WDI grezzo — usato da map.js e discipline-classifier
  window.currentWDI_norm   = null;   // WDI normalizzato 0–10 per categoria — solo display
  window.lastRS            = null;
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
        /* WizMap.init() rimosso — la mappa Leaflet è ora inizializzata
     da wiztrail-pacing.js che espone window._wizMap e window._wizHoverMarker.
     drawTrack() e drawProfile() usano _wizMap già pronto. */
        setTimeout(() => {
          WizMap.drawTrack();
          WizMap.drawProfile();
          WizMap.fitTrack();
        }, 120);
      }

      // Pacing: avviso se manca GPX
      /* Tab pacing rimosso — il pacing è ora sezione fissa post-calcolo */
    });
  });

  /* ------------------------------------------------------------------
     CARICAMENTO GPX / TCX
     ------------------------------------------------------------------ */
  // ── GPX handler condiviso (click + drag&drop) ────────────────────────
  async function handleGpxFile(f) {
    if (!f) return;
    const txt = await f.text();
    const xml = new DOMParser().parseFromString(txt, 'application/xml');
    window.gpxPts  = GPXParser.parseTrack(xml);
    window.metrics = GPXParser.compute(window.gpxPts);
    WizUI.updateGpxInfo(window.gpxPts, window.metrics);
    /* Mostra elevSection PRIMA di init mappa: #pacingMap deve avere dimensioni
       reali (clientWidth/Height > 0) quando Leaflet si inizializza.
       Leaflet su container display:none → mappa 0×0 → tiles non caricate.
       Stesso principio del pattern training-analyzer.html che funziona. */
    const es = document.getElementById('elevSection');
    if (es) es.style.display = 'block';
    WizMap.init();
    WizMap.drawTrack();
    /* requestAnimationFrame garantisce layout applicato prima del disegno canvas */
    requestAnimationFrame(() => WizMap.drawProfile());
    // Feedback dropzone
    const dz = document.getElementById('gpxDropzone');
    if (dz) {
      dz.classList.add('loaded');
      const mainTxt = dz.querySelector('.gpx-dropzone-main');
      if (mainTxt) mainTxt.textContent = '✓ ' + f.name;
    }
  }

  document.getElementById('gpxfile')?.addEventListener('change', async e => {
    await handleGpxFile(e.target.files[0]);
  });

  // Drag & drop sulla dropzone
  const gpxDz = document.getElementById('gpxDropzone');
  if (gpxDz) {
    ['dragenter','dragover'].forEach(ev =>
      gpxDz.addEventListener(ev, e => { e.preventDefault(); gpxDz.classList.add('dragover'); })
    );
    ['dragleave','dragend'].forEach(ev =>
      gpxDz.addEventListener(ev, () => gpxDz.classList.remove('dragover'))
    );
    gpxDz.addEventListener('drop', async e => {
      e.preventDefault();
      gpxDz.classList.remove('dragover');
      await handleGpxFile(e.dataTransfer?.files?.[0]);
    });
  }

  /* ------------------------------------------------------------------
     IMPORT DA URL/LINK
     ------------------------------------------------------------------ */
  (function setupLinkImport() {
    const btn    = document.getElementById('linkImportBtn');
    const row    = document.getElementById('linkImportRow');
    const input  = document.getElementById('linkImportUrl');
    const goBtn  = document.getElementById('linkImportGo');
    if (!btn || !row || !input || !goBtn) return;

    btn.addEventListener('click', () => {
      const open = row.style.display !== 'none' && row.style.display !== '';
      row.style.display = open ? 'none' : 'flex';
      if (!open) input.focus();
    });

    async function importFromUrl() {
      const raw = input.value.trim();
      if (!raw) return;

      const dz      = document.getElementById('gpxDropzone');
      const mainTxt = dz?.querySelector('.gpx-dropzone-main');
      if (mainTxt) mainTxt.textContent = 'Caricamento…';
      goBtn.disabled = true;

      try {
        const res = await fetch('/api/import/url?url=' + encodeURIComponent(raw));
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Errore nel caricamento');
        }
        const text = await res.text();
        const xml  = new DOMParser().parseFromString(text, 'application/xml');
        window.gpxPts  = GPXParser.parseTrack(xml);
        window.metrics = GPXParser.compute(window.gpxPts);

        if (!window.gpxPts.length) throw new Error('Nessuna traccia trovata nel file');

        WizUI.updateGpxInfo(window.gpxPts, window.metrics);
        const es = document.getElementById('elevSection');
        if (es) es.style.display = 'block';
        WizMap.init();
        WizMap.drawTrack();
        requestAnimationFrame(() => WizMap.drawProfile());

        if (dz) dz.classList.add('loaded');
        if (mainTxt) mainTxt.textContent = '✓ Traccia caricata da link';
        row.style.display = 'none';
        input.value = '';
      } catch (e) {
        if (mainTxt) mainTxt.textContent = '✗ ' + e.message;
        if (dz) dz.classList.remove('loaded');
      } finally {
        goBtn.disabled = false;
      }
    }

    goBtn.addEventListener('click', importFromUrl);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') importFromUrl(); });
  })();

  /* ------------------------------------------------------------------
     WEB SHARE TARGET — GPX condiviso da un'altra app mobile
     Il service worker intercetta il POST e mette il file in cache;
     qui lo recuperiamo e lo carichiamo.
     ------------------------------------------------------------------ */
  (async function loadSharedGpx() {
    const sp = new URLSearchParams(location.search);
    if (sp.get('shared') !== '1') return;
    history.replaceState(null, '', location.pathname);

    try {
      const cache = await caches.open('wiztrail-share-queue');
      const stored = await cache.match('/shared-gpx');
      if (!stored) return;

      const blob     = await stored.blob();
      const filename = stored.headers.get('X-Filename') || 'shared.gpx';
      await cache.delete('/shared-gpx');

      const file = new File([blob], filename, { type: blob.type || 'application/gpx+xml' });
      await handleGpxFile(file);
    } catch (e) {
      console.error('share target load error:', e);
    }
  })();

  /* ------------------------------------------------------------------
     AUTO-LOAD DA STRAVA (index.html?source=strava&id=...)
     Attivato quando l'utente torna da import_strava.html
     ------------------------------------------------------------------ */
  (async function loadFromStravaIfNeeded() {
    const sp = new URLSearchParams(location.search);
    if (sp.get('source') !== 'strava') return;
    const activityId = sp.get('id');
    if (!activityId || !/^\d{1,20}$/.test(activityId)) return;

    const token = sessionStorage.getItem('strava_token');
    if (!token) return;

    // Feedback visivo
    const dz = document.getElementById('gpxDropzone');
    const mainTxt = dz?.querySelector('.gpx-dropzone-main');
    if (mainTxt) mainTxt.textContent = 'Caricamento da Strava…';

    let data;
    try {
      const res = await fetch('/api/strava/activity?mode=analyze&id=' + encodeURIComponent(activityId), {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.status === 401) {
        sessionStorage.removeItem('strava_token');
        sessionStorage.removeItem('strava_athlete_id');
        if (mainTxt) mainTxt.textContent = 'Sessione Strava scaduta — riconnettiti';
        return;
      }
      if (!res.ok) {
        if (mainTxt) mainTxt.textContent = 'Errore nel caricamento attività Strava';
        return;
      }
      data = await res.json();
    } catch {
      if (mainTxt) mainTxt.textContent = 'Errore di rete — riprova';
      return;
    }

    if (!data.pts || !data.pts.length) {
      if (mainTxt) mainTxt.textContent = 'Attività senza traccia GPS';
      return;
    }

    window.gpxPts  = data.pts;
    window.metrics = data.metrics;
    WizUI.updateGpxInfo(window.gpxPts, window.metrics);

    const es = document.getElementById('elevSection');
    if (es) es.style.display = 'block';
    WizMap.init();
    WizMap.drawTrack();
    requestAnimationFrame(() => WizMap.drawProfile());

    if (dz) dz.classList.add('loaded');
    if (mainTxt) mainTxt.textContent = '✓ Attività Strava caricata';

    // Rimuove i params dall'URL senza ricaricare la pagina
    history.replaceState(null, '', location.pathname);
  })();

  /* ------------------------------------------------------------------
     PULSANTE "Centra sulla traccia"
     ------------------------------------------------------------------ */
  document.getElementById('btnFit')?.addEventListener('click', () => WizMap.fitTrack());

  /* ------------------------------------------------------------------
     EXPORT KML
     ------------------------------------------------------------------ */
  document.getElementById('btnKml')?.addEventListener('click', () => {
    if (!window.gpxPts.length) { WizUI.showError('Carica prima un GPX'); return; }

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
     ENGINE TIME ESTIMATOR v2.0 — funzioni delegate a wiztrail-timing.js
     ------------------------------------------------------------------ */
  const velocityFromSlope = WizTrailTiming.velocityFromSlope;
  const technicalPenalty  = WizTrailTiming.technicalPenalty;
  const fatigueFactor     = WizTrailTiming.fatigueFactor;

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
    const velBase = 60 / (m10 / 10); // km/h — m10 è minuti su 10km (es. 50:00 = 5min/km)

    const terrainClass = document.getElementById('terrain')?.value || 'E';
    const velBaseEff   = velBase * (WizTrailTiming.TRAIL_BASE_FACTOR[terrainClass] ?? 0.90);
    const S      = readNum('spec');
    const meteo  = readNum('meteo');
    const alt    = readNum('alt');
    const margin = readNum('margin') / 100;

    // Calcola metrics dal GPX per coordinate e profilo altimetrico
    const mGpx = GPXParser.compute(window.gpxPts);

    // Leggi distanza e D+ dai campi form — l'utente può averli corretti manualmente
    const manualKm   = readNum('dist');
    const manualGain = readNum('dplus');

    // Valida bounds distanza e D+ (HTML min/max bypassabili via JS/DevTools)
    if (manualKm > 0 && (manualKm < 0.1 || manualKm > 500)) {
      WizUI.showError('Distanza non valida (0.1 – 500 km)');
      return;
    }
    if (manualGain > 30000) {
      WizUI.showError('D+ non valido (max 30.000 m)');
      return;
    }

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
      const velLocal  = velocityFromSlope(seg.slope, S, velBaseEff);
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

    // WDI — se GPX senza elevazione usa computeManual per TechScore realistico
    // (computeFromGpx con e=[0,0,...] darebbe frip=slopeVar=roughness=0 → WDI bassissimo)
    const hasRealElevation = mGpx.gain > 0;
    let rs;
    if (!hasRealElevation && manualGain > 0) {
      rs = WizTrail.computeManual({
        km:          m.km,
        gain:        manualGain,
        loss:        manualGain,
        terrainCat:  window.currentTerrainCat  || 'EE',
        altMedia:    m.altMedia || 800,
      });
    } else {
      rs = WizTrail.computeFromGpx(
        window.gpxPts,
        m,
        null,
        window.lastOsmResult
      );
    }
    window.currentWDI      = rs.WDI;        // grezzo — per map.js e calcoli
    window.currentWDI_norm = rs.WDI_norm;   // normalizzato — per display futuro
    window.lastRS          = rs;

    WizUI.showWDI(rs);
    WizUI.showResults(T, margin);

    const livello = WizTrailTiming.levelFromS(S);

    // Passo medio sul percorso trail (dal tempo segmenti, non dalla velocità base)
    const pace_trail = (T / 60) / m.km;
    const isSkyrace  = (m.gain / Math.max(m.km, 1)) > 60;

    const subEl = document.getElementById('outFinalSub');
    if (subEl) {
      subEl.innerHTML =
        pace_trail.toFixed(1) + ' min/km medi sul percorso' +
        ' &nbsp;·&nbsp; ' + livello +
        (isSkyrace ? ' &nbsp;·&nbsp; skyrace' : '') +
        '<br><span style="opacity:0.5; font-size:0.72rem;">modello segmenti v2.0</span>';
    }

    // Mostra riga intervallo con percentuale margine
    const rowEl = document.getElementById('intervalRow');
    const pctEl = document.getElementById('marginPct');
    if (rowEl) rowEl.style.display = '';
    if (pctEl) pctEl.textContent = Math.round(margin * 100);
    document.querySelectorAll('.kpi-placeholder').forEach(el => el.remove());
    WizUI.showError('OK');

    /* Mostra sezioni fisse post-calcolo */
    const elevSec   = document.getElementById('elevSection');
    const pacingSec = document.getElementById('pacingSection');
    const fbBtn     = document.getElementById('feedbackBtn');
    if (elevSec)   elevSec.style.display   = 'block';
    if (pacingSec) pacingSec.style.display = 'block';
    if (fbBtn)     fbBtn.style.display     = 'block';

    /* Leaflet non renderizza su container hidden — invalidateSize forza il re-render
       dopo che #pacingSection diventa visibile (display:none → block).
       setTimeout garantisce che il browser aggiorni il layout prima della chiamata. */
    /* map.js.init() ora è una vera init — crea la mappa su #pacingMap che è
       SEMPRE visibile (dentro #elevSection, non dentro display:none).
       Nessuna race condition: WizMap.init() chiamato qui garantisce la mappa pronta. */
    WizMap.init();
    setTimeout(() => { WizMap.drawTrack(); }, 80);

    /* Badge disciplina — solo se GPX caricato (max_altitude disponibile).
       In modalità manuale gpxPts è vuoto → badge nascosto. */
    if (window.gpxPts && window.gpxPts.length > 0 &&
        typeof DisciplineClassifier !== 'undefined') {
      const disc = DisciplineClassifier.classify({
        distance_km:  m.km,
        dplus:        m.gain,
        max_altitude: m.max_altitude || 0,
        wdi:          rs.WDI,
      });
      WizUI.showDiscipline(disc);
    } else {
      WizUI.showDiscipline(null); // nasconde il badge in modalità manuale
    }

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
        tempo_finale:     g('outFinal'),
        low:              g('outLow'),
        high:             g('outHigh'),
        stima_personale:  g('outPersonalTime') || null,
        WDI:              window.lastRS ? window.lastRS.WDI.toFixed(1)      : null,
        WDI_norm:         window.lastRS ? window.lastRS.WDI_norm             : null,
        WDI_category:     window.lastRS ? window.lastRS.WDI_category         : null,
        WDI_legendPlus:   window.lastRS ? window.lastRS.WDI_legendPlus       : false,
        WDI_class:        window.lastRS ? window.lastRS.class                : null,
        WDI_color:        window.lastRS ? window.lastRS.color                : null,
        TechScore:        window.lastRS ? window.lastRS.TechScore.toFixed(1) : null,
        techClass:        window.lastRS ? window.lastRS.techClass            : null,
        techColor:        window.lastRS ? window.lastRS.techColor            : null,
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

  // wiztrail-osm.js disabilitato: OSM Enhanced rimosso (0% copertura Overpass API).
  // Da ripristinare con proxy serverless + CORINE (vedi task Notion).

  /* ------------------------------------------------------------------
     HERO — carica immagine Unsplash + CTA scroll
     ------------------------------------------------------------------ */
  const heroBg = document.getElementById('heroBgImg');
  if (heroBg) {
    const heroImg = new Image();
    heroImg.onload = () => {
      heroBg.style.backgroundImage = `url('${heroImg.src}')`;
      heroBg.classList.add('hero-bg-loaded');
    };
    heroImg.src = 'img/hero-index.jpg';
  }

  document.getElementById('heroCtaBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('.tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Attiva il tab calcolatore
    const calcBtn = document.querySelector('[data-tab="calc"]');
    if (calcBtn) calcBtn.click();
  });

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
