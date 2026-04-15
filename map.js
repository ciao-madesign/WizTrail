/**
 * map.js — WizTrail Map & Elevation Profile
 * Estratto da index.html nel refactoring Fase 1.
 * Dipende da: Leaflet globale, window.gpxPts, window.metrics, window.currentWDI
 * Esposto come window.WizMap = { init, drawTrack, fitTrack, drawProfile }
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     STATO INTERNO
     ------------------------------------------------------------------ */
  let map         = null;
  let poly        = null;
  let hoverMarker = null;

  // Stato canvas profilo altimetrico
  let elevCanvas = null;
  let elevCtx    = null;
  const elevState = {
    pxW: 0, pxH: 0,
    dpi: Math.max(1, window.devicePixelRatio || 1),
    padding: { top: 16, right: 14, bottom: 26, left: 42 },
    x: [], y: [],
    min: 0, max: 0,
    distKm: [],
  };

  /* ------------------------------------------------------------------
     HELPERS — formattazione
     ------------------------------------------------------------------ */
  function _formatKm(x) { return x.toFixed(2).replace('.', ','); }
  function _formatM(x)  { return Math.round(x) + ' m'; }

  /* ------------------------------------------------------------------
     COLORE TRACCIA in base al WDI
     ------------------------------------------------------------------ */
  function getColorWDI(wdi) {
    // ⚠ Soglie provvisorie — sincronizzare con WDI_THRESHOLDS in wiztrail-engine.js
    if (!wdi || wdi < 14)  return '#2BB7DA';  // Sport
    if (wdi < 30)          return '#34A853';  // Pro
    if (wdi < 55)          return '#F4C20D';  // Advanced
    if (wdi < 105)         return '#F79617';  // Extreme
    if (wdi < 165)         return '#E91E63';  // Elite
    return '#8E24AA';                          // Legend
  }

  /* ------------------------------------------------------------------
     LEAFLET — inizializzazione mappa
     ------------------------------------------------------------------ */
  function init() {
    if (map) return;

    map = L.map('leafletMap');

    const darkBase = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap, © CartoDB' }
    );

    const topoOverlay = L.tileLayer(
      'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { maxZoom: 17, opacity: 0.35, attribution: '© OpenTopoMap (CC-BY-SA)' }
    );

    L.layerGroup([darkBase, topoOverlay]).addTo(map);

    hoverMarker = L.circleMarker([0, 0], {
      radius: 6, color: '#ff0', fillColor: '#ff0',
    });

    map.setView([46.5, 8.3], 5);

    // Espone hoverMarker per il profilo altimetrico
    window._wizHoverMarker = hoverMarker;
    window._wizMap = map;
  }

  /* ------------------------------------------------------------------
     LEAFLET — disegna traccia
     ------------------------------------------------------------------ */
  function drawTrack() {
    if (!map || !window.gpxPts || !window.gpxPts.length) return;
    if (poly) map.removeLayer(poly);

    poly = L.polyline(
      window.gpxPts.map(p => [p[0], p[1]]),
      { color: getColorWDI(window.currentWDI), weight: 4 }
    ).addTo(map);

    fitTrack();
  }

  /* ------------------------------------------------------------------
     LEAFLET — centra sulla traccia
     ------------------------------------------------------------------ */
  function fitTrack() {
    if (poly) map.fitBounds(poly.getBounds(), { padding: [20, 20] });
  }

  /* ==================================================================
     PROFILO ALTIMETRICO (Canvas)
     ================================================================== */

  function _setupCanvasSize() {
    elevCanvas = document.getElementById('elevCanvas');
    if (!elevCanvas) return false;

    const cssW = elevCanvas.clientWidth || elevCanvas.offsetWidth || 600;
    const cssH = elevCanvas.clientHeight || 160;
    elevState.dpi = Math.max(1, window.devicePixelRatio || 1);

    elevCanvas.width  = Math.round(cssW * elevState.dpi);
    elevCanvas.height = Math.round(cssH * elevState.dpi);
    elevCtx = elevCanvas.getContext('2d');
    elevCtx.setTransform(elevState.dpi, 0, 0, elevState.dpi, 0, 0);

    elevState.pxW = cssW;
    elevState.pxH = cssH;
    return true;
  }

  function _computeProfileCoords() {
    const metrics = window.metrics;
    if (!metrics || !metrics.e || !metrics.d || metrics.e.length < 2) return false;

    const elev = metrics.e;
    const dist = metrics.d;
    const n    = elev.length;

    const pad = elevState.padding;
    const W   = elevState.pxW - pad.left - pad.right;
    const H   = elevState.pxH - pad.top  - pad.bottom;

    let minE = Math.min(...elev.filter(Number.isFinite));
    let maxE = Math.max(...elev.filter(Number.isFinite));
    if (!Number.isFinite(minE) || minE === maxE) { minE -= 1; maxE += 1; }
    const margin = (maxE - minE) * 0.05;
    minE -= margin; maxE += margin;

    const totalM = dist[dist.length - 1] || 0.0001;

    elevState.x       = new Array(n);
    elevState.y       = new Array(n);
    elevState.min     = minE;
    elevState.max     = maxE;
    elevState.distKm  = dist.map(m => m / 1000);

    for (let i = 0; i < n; i++) {
      const fx = dist[i] / totalM;
      const fy = (elev[i] - minE) / (maxE - minE);
      elevState.x[i] = pad.left + fx * W;
      elevState.y[i] = pad.top  + (1 - fy) * H;
    }
    return true;
  }

  function _drawAxes() {
    const ctx = elevCtx, pad = elevState.padding;
    const W = elevState.pxW, H = elevState.pxH;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;

    // Linee orizzontali (quota)
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * (H - pad.top - pad.bottom);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }

    // Linee verticali (distanza)
    for (let i = 0; i <= 5; i++) {
      const x = pad.left + (i / 5) * (W - pad.left - pad.right);
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(232,242,255,0.85)';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';

    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(_formatM(elevState.max), 6, 6);

    ctx.textBaseline = 'bottom';
    ctx.fillText(_formatM(elevState.min), 6, H - 6);

    const totKm = elevState.distKm[elevState.distKm.length - 1] || 0;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${_formatKm(totKm)} km`, W - 6, H - 6);
  }

  function _drawProfileLine() {
    const ctx = elevCtx, pad = elevState.padding;
    const xs = elevState.x, ys = elevState.y;
    if (!xs.length) return;

    const baseY = elevState.pxH - pad.bottom;
    const grad  = ctx.createLinearGradient(0, pad.top, 0, baseY);
    grad.addColorStop(0, 'rgba(79, 209, 197, 0.25)');
    grad.addColorStop(1, 'rgba(14, 165, 233, 0.08)');

    ctx.beginPath();
    ctx.moveTo(xs[0], baseY);
    for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.lineTo(xs[xs.length - 1], baseY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.strokeStyle = '#4fd1c5';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* Hover + sincronizzazione mappa */
  let _profileEventsAttached = false;

  function _attachProfileEvents() {
    if (!elevCanvas || _profileEventsAttached) return;
    _profileEventsAttached = true;

    const pad = elevState.padding;

    // Tooltip DOM element
    const tip = document.createElement('div');
    Object.assign(tip.style, {
      position: 'absolute', pointerEvents: 'none',
      padding: '4px 6px',
      font: '12px system-ui, -apple-system, Segoe UI, Roboto, Arial',
      background: 'rgba(0,0,0,0.65)', color: '#e8f2ff',
      border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px',
      transform: 'translate(-50%,-120%)', display: 'none',
    });
    elevCanvas.parentElement.style.position =
      elevCanvas.parentElement.style.position || 'relative';
    elevCanvas.parentElement.appendChild(tip);

    function indexFromClientX(clientX) {
      const rect = elevCanvas.getBoundingClientRect();
      const x    = clientX - rect.left;
      const xs   = elevState.x;
      const n    = xs.length;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < x) lo = mid + 1; else hi = mid;
      }
      const i = Math.max(0, Math.min(n - 1, lo));
      return (i > 0 && Math.abs(xs[i - 1] - x) < Math.abs(xs[i] - x)) ? i - 1 : i;
    }

    function drawHover(i) {
      const xs = elevState.x, ys = elevState.y;
      _drawAxes(); _drawProfileLine();

      elevCtx.save();
      elevCtx.strokeStyle = 'rgba(255,255,255,0.35)';
      elevCtx.lineWidth = 1;
      elevCtx.beginPath();
      elevCtx.moveTo(xs[i], pad.top);
      elevCtx.lineTo(xs[i], elevState.pxH - pad.bottom);
      elevCtx.stroke();
      elevCtx.fillStyle = '#ffb020';
      elevCtx.beginPath();
      elevCtx.arc(xs[i], ys[i], 3, 0, Math.PI * 2);
      elevCtx.fill();
      elevCtx.restore();

      const km = elevState.distKm[i] || 0;
      const m  = (window.metrics && window.metrics.e[i]) || 0;
      tip.textContent = `${_formatKm(km)} km • ${_formatM(m)}`;
      tip.style.left    = `${xs[i]}px`;
      tip.style.top     = `${ys[i]}px`;
      tip.style.display = 'block';
    }

    function syncMap(i) {
      const m = window._wizMap, h = window._wizHoverMarker;
      if (!m || !h || !window.gpxPts || !window.gpxPts[i]) return;
      h.setLatLng([window.gpxPts[i][0], window.gpxPts[i][1]]).addTo(m);
    }

    function handleMove(clientX) {
      if (!elevState.x.length) return;
      const i = indexFromClientX(clientX);
      drawHover(i); syncMap(i);
    }

    function leave() {
      tip.style.display = 'none';
      _drawAxes(); _drawProfileLine();
    }

    elevCanvas.addEventListener('mousemove',  e => handleMove(e.clientX));
    elevCanvas.addEventListener('mouseleave', leave);
    elevCanvas.addEventListener('touchstart', e => { if (e.touches[0]) handleMove(e.touches[0].clientX); }, { passive: true });
    elevCanvas.addEventListener('touchmove',  e => { if (e.touches[0]) handleMove(e.touches[0].clientX); }, { passive: true });
    elevCanvas.addEventListener('touchend',   leave);
    window.addEventListener('resize', drawProfile, { passive: true });
  }

  /* API pubblica profilo */
  function drawProfile() {
    if (!window.gpxPts || window.gpxPts.length < 2) {
      const c = document.getElementById('elevCanvas');
      if (c) {
        _setupCanvasSize();
        elevCtx.clearRect(0, 0, elevState.pxW, elevState.pxH);
        elevCtx.fillStyle = 'rgba(232,242,255,0.7)';
        elevCtx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        elevCtx.fillText('Carica una traccia GPX/TCX per vedere il profilo.', 12, 24);
      }
      return;
    }
    if (!_setupCanvasSize()) return;
    if (!_computeProfileCoords()) return;
    _drawAxes();
    _drawProfileLine();
    _profileEventsAttached = false; // reset per permettere ri-attach dopo resize
    _attachProfileEvents();
  }

  /* ------------------------------------------------------------------
     Esposizione globale
     ------------------------------------------------------------------ */
  window.WizMap = { init, drawTrack, fitTrack, drawProfile, getColorWDI };

  // Alias diretti per retrocompatibilità con chiamate già presenti nel codice
  window.initLeaflet  = init;
  window.drawTrack    = drawTrack;
  window.fitTrack     = fitTrack;
  window.drawProfile  = drawProfile;

})();
