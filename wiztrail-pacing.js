/***************************************************************
 *  WIZTRAIL — PACING PLANNER (v2.0 semplificato e realistico)
 ***************************************************************/

/***************************************************************
 *  UTILITIES
 ***************************************************************/
function pc_safeNum(v) { return Number.isFinite(v) ? v : 0; }

function pc_secToHMS(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

function pc_secToPace(secPerKm) {
  const mm = Math.floor(secPerKm / 60);
  const ss = Math.round(secPerKm % 60);
  return `${mm}:${String(ss).padStart(2,'0')}/km`;
}

/***************************************************************
 *  SEGMENTAZIONE GPX
 ***************************************************************/
function pc_buildSegments(gpxPts, metrics) {
  const segments = [];
  if (!gpxPts || gpxPts.length < 2) return segments;

  for (let i = 0; i < gpxPts.length - 1; i++) {
    const d1 = pc_safeNum(metrics.d[i]);
    const d2 = pc_safeNum(metrics.d[i + 1]);
    const dist = d2 - d1;
    if (dist <= 0) continue;

    const elev1 = pc_safeNum(metrics.e[i]);
    const elev2 = pc_safeNum(metrics.e[i+1]);

    segments.push({
      index: i,
      startDist_m: d1,
      endDist_m: d2,
      dist_m: dist,
      elev_diff: elev2 - elev1
    });
  }

  return segments;
}

/***************************************************************
 *  COSTO LOCALE SEGMENTO (SEMPLIFICATO E REALISTICO)
 ***************************************************************/
function pc_segmentCost(seg, params) {

  const dist = seg.dist_m;
  const slope = (seg.elev_diff ?? 0) / Math.max(dist, 1);

  // ---------------------------------------------------------
  // A) PENDENZA (versione semplificata ma realistica)
  // ---------------------------------------------------------
  let slopeF = 1;

  if (slope > 0) {
    // salite
    if (slope < 0.05)       slopeF = 1 + slope * 6;   // +0-30%
    else if (slope < 0.12)  slopeF = 1 + slope * 10;  // +60-120%
    else                    slopeF = 1 + slope * 18;  // salite dure
  }
  else if (slope < 0) {
    // discese
    if (slope > -0.10)      slopeF = 1 - Math.abs(slope) * 2; // lieve accelerazione
    else                    slopeF = 1 + Math.abs(slope) * 3; // discesa ripida → rallenta
  }

  // ---------------------------------------------------------
  // B) TECNICA (globale, semplificata)
  // ---------------------------------------------------------
  const terr = params.terrainClass || "Strada";
  let techF = 1;

  if (terr === "E") techF = 1.05;

  if (terr === "EE" && (slope > 0.08 || slope < -0.12))
      techF = 1.15;

  if (terr === "EA" && (slope > 0.08 || slope < -0.12))
      techF = 1.30;

  // ---------------------------------------------------------
  // C) METEO / ALTITUDINE (coerenti con calcolatore)
  // ---------------------------------------------------------
  const meteo = params.meteo ?? 1;
  const alt   = params.alt   ?? 1;

  // ---------------------------------------------------------
  // D) COSTO SEMPLIFICATO
  // ---------------------------------------------------------
  return dist * slopeF * techF * meteo * alt;
}

/***************************************************************
 *  COSTI TOTALI DEI SEGMENTI
 ***************************************************************/
function pc_computeAllCosts(segments, params) {
  const costs = [];
  let total = 0;

  params.totalDistance_m = segments.length
    ? segments[segments.length - 1].endDist_m
    : 0;

  for (let i = 0; i < segments.length; i++) {
    const c = pc_segmentCost(segments[i], params);
    costs.push(c);
    total += c;
  }

  return { costs, C_total: total };
}

/***************************************************************
 *  CREA CHUNK (5/10 km)
 ***************************************************************/
function buildPacingChunks(segments, params, gran_km) {
  const chunks = [];
  let currentKm = gran_km;
  let startIdx = 0;

  for (let i = 0; i < segments.length; i++) {
    const endKm = segments[i].endDist_m / 1000;

    if (endKm >= currentKm || i === segments.length - 1) {

      const segs = segments.slice(startIdx, i + 1);

      let totalCost = 0;
      const localCosts = segs.map(s => {
        const c = pc_segmentCost(s, params);
        totalCost += c;
        return c;
      });

      let dist_m = 0;
      segs.forEach(s => dist_m += s.dist_m);

      chunks.push({
        km: currentKm,
        dist_km: dist_m / 1000,
        segs,
        localCosts,
        totalCost
      });

      currentKm += gran_km;
      startIdx = i + 1;
    }
  }

  return chunks;
}

/***************************************************************
 *  TEMPI DEI CHUNK (DISTRIBUZIONE PROPORZIONALE)
 ***************************************************************/
function computeChunkTimes(pacingChunks, params, T_target_sec) {

  // 1. somma costi di tutti i chunk
  let totalCost = 0;
  pacingChunks.forEach(c => totalCost += c.totalCost);

  // 2. distribuzione tempo → proporzionale alla difficoltà locale
  let cumulative = 0;

  pacingChunks.forEach(chunk => {

    const ratio = chunk.totalCost / totalCost;
    chunk.time_sec = T_target_sec * ratio;

    cumulative += chunk.time_sec;
    chunk.cumulative_sec = cumulative;
  });

  return pacingChunks;
}

/***************************************************************
 *  GENERATORE PACING
 ***************************************************************/
function generatePacingPlan({ gpxPts, metrics, params, T_target_sec, gran_km = 5 }) {

  const t10str = document.getElementById("t10k")?.value || "50:00";
  const p10 = t10str.split(":");
  params.t10_sec = (+p10[0]) * 60 + (+p10[1]);

  const segments = pc_buildSegments(gpxPts, metrics);
  if (!segments.length) return { error: "Traccia insufficiente." };

  pc_computeAllCosts(segments, params);
  const pacingChunks = buildPacingChunks(segments, params, gran_km);
  const enrichedChunks = computeChunkTimes(pacingChunks, params, T_target_sec);

  return {
    pacingChunks: enrichedChunks,
    granularity_km: gran_km,
    target_time: T_target_sec
  };
}

/***************************************************************
 *  RENDER TABELLA
 ***************************************************************/
function pc_renderTable(pacingChunks, avgPaceSec) {
  const el = document.getElementById("pc_table");
  if (!el) return;

  let html = `
    <table class="pacing-table">
      <tr>
        <th>KM</th>
        <th>Tempo</th>
        <th>Pace tratto</th>
      </tr>
  `;

  pacingChunks.forEach(chunk => {
    const paceSec = chunk.time_sec / chunk.dist_km;
    const paceStr = pc_secToPace(paceSec);
    const color = (paceSec > avgPaceSec) ? "#ff00a8" : "#4fd1c5";

    html += `
      <tr>
        <td>${chunk.km}</td>
        <td>${pc_secToHMS(chunk.cumulative_sec)}</td>
        <td style="color:${color}; font-weight:600;">${paceStr}</td>
      </tr>`;
  });

  html += `</table>`;
  el.innerHTML = html;
}

/***************************************************************
 *  MAPPA PACING (Leaflet)
 ***************************************************************/
let pacingMap = null;
let pacingLayers = [];

function initPacingMap() {
  if (!pacingMap) {
    pacingMap = L.map("pacingMap");
    const darkBase = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 17 }
    );
    const topo = L.tileLayer(
      "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { opacity: 0.35, maxZoom: 16 }
    );
    L.layerGroup([darkBase, topo]).addTo(pacingMap);
  }
}

function drawPacingMap(pacingChunks, avgPaceSec) {
  if (!gpxPts || !gpxPts.length) return;

  initPacingMap();


  // pulizia layer precedenti
  pacingLayers.forEach(l => pacingMap.removeLayer(l));
  pacingLayers = [];

  pacingMap.setView([gpxPts[0][0], gpxPts[0][1]], 13);

  pacingChunks.forEach(chunk => {
    const paceSec = chunk.time_sec / chunk.dist_km;

    const color =
      paceSec > avgPaceSec ? "#ff00a8" : "#4fd1c5";

    // costruzione polyline chunk
    const segPts = chunk.segs.map(s => {
      const idx = s.index;
      return [gpxPts[idx][0], gpxPts[idx][1]];
    });

    const poly = L.polyline(segPts, {
      color,
      weight: 6,
      opacity: 0.95
    }).addTo(pacingMap);

    pacingLayers.push(poly);
  });

  // fit globale
  const allPts = gpxPts.map(p => [p[0], p[1]]);
  pacingMap.fitBounds(allPts, { padding: [20, 20] });
}

/***************************************************************
 *  PROFILO ALTIMETRICO PER PACING (canvas)
 ***************************************************************/
let pacingElevState = {
  x: [], y: [],
  pxW:0, pxH:0,
  dpi:1,
  padding:{top:16,right:16,bottom:26,left:42},
  min:0, max:0
};

function pacingSetupCanvas() {
  const canvas = document.getElementById("pacingElevCanvas");
  if (!canvas) return null;

  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;

  pacingElevState.dpi = Math.max(1, window.devicePixelRatio || 1);
  canvas.width  = Math.round(cssW * pacingElevState.dpi);
  canvas.height = Math.round(cssH * pacingElevState.dpi);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(pacingElevState.dpi,0,0,pacingElevState.dpi,0,0);

  pacingElevState.pxW = cssW;
  pacingElevState.pxH = cssH;
  return ctx;
}

function pacingComputeProfile(coords) {
  if (!metrics || !metrics.e.length) return false;
  const e = metrics.e, d = metrics.d;
  const n = e.length;

  const pad = pacingElevState.padding;
  const W = pacingElevState.pxW - pad.left - pad.right;
  const H = pacingElevState.pxH - pad.top  - pad.bottom;

  let minE = Math.min(...e);
  let maxE = Math.max(...e);
  const margin = (maxE - minE) * 0.05;
  minE -= margin; maxE += margin;

  pacingElevState.min = minE;
  pacingElevState.max = maxE;

  pacingElevState.x = new Array(n);
  pacingElevState.y = new Array(n);

  const totalM = d[d.length-1];

  for (let i=0; i<n; i++) {
    const fx = d[i] / totalM;
    const fy = (e[i] - minE) / (maxE - minE);
    pacingElevState.x[i] = pad.left  + fx * W;
    pacingElevState.y[i] = pad.top   + (1 - fy) * H;
  }
  return true;
}

function pacingDrawProfile() {
  const canvas = document.getElementById("pacingElevCanvas");
  const ctx = pacingSetupCanvas();
  if (!ctx) return;

  if (!pacingComputeProfile()) {
    ctx.fillStyle="rgba(255,255,255,0.7)";
    ctx.fillText("Carica un GPX",20,20);
    return;
  }

  const pad = pacingElevState.padding;
  const xs  = pacingElevState.x;
  const ys  = pacingElevState.y;

  ctx.clearRect(0,0,canvas.width,canvas.height);

  // area
  const baseY = pacingElevState.pxH - pad.bottom;
  const grad = ctx.createLinearGradient(0, pad.top, 0, baseY);
  grad.addColorStop(0,'rgba(79,209,197,0.25)');
  grad.addColorStop(1,'rgba(14,165,233,0.08)');

  ctx.beginPath();
  ctx.moveTo(xs[0], baseY);
  for (let i=0; i<xs.length; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.lineTo(xs[xs.length-1], baseY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i=1; i<xs.length; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.strokeStyle = '#4fd1c5';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/***************************************************************
 *  SINCRONIZZAZIONE CURSORE MAPPA ↔ PROFILO
 ***************************************************************/
let pacingHoverMarker = null;

function pacingAttachEvents() {
  const canvas = document.getElementById("pacingElevCanvas");
  const ctx = canvas.getContext("2d");
  const xs = pacingElevState.x, ys = pacingElevState.y;
  const pad = pacingElevState.padding;

  if (!pacingHoverMarker && pacingMap) {
    pacingHoverMarker = L.circleMarker([0,0],{
      radius:6, color:"#ff0", fillColor:"#ff0"
    }).addTo(pacingMap);
  }

  function idxFromX(clientX){
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0, bestDist = Infinity;
    for (let i=0; i<xs.length; i++){
      const d = Math.abs(xs[i] - x);
      if (d < bestDist){ bestDist = d; best = i; }
    }
    return best;
  }

  function drawHover(i){
    pacingDrawProfile(); // redraw base

    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.moveTo(xs[i], pad.top);
    ctx.lineTo(xs[i], pacingElevState.pxH - pad.bottom);
    ctx.stroke();
    ctx.restore();

    // Sync marker on map
    const p = gpxPts[i];
    if (p) pacingHoverMarker.setLatLng([p[0],p[1]]);
  }

  canvas.onmousemove = e => drawHover(idxFromX(e.clientX));
  canvas.onmouseleave = e => pacingDrawProfile();
}
/***************************************************************
 *  RENDER SUMMARY
 ***************************************************************/
function pc_renderSummary(avgPaceSec) {
  const box = document.getElementById("pc_summary");
  if (!box) return;

  box.innerHTML = `
      <div class="pc-summary-box">
        Passo medio complessivo previsto:
        <strong>${pc_secToPace(avgPaceSec)}</strong>
      </div>
  `;
}

/***************************************************************
 *  EVENT HANDLER
 ***************************************************************/
let PC_PLAN = null;

document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("pc_generate")?.addEventListener("click", () => {

    if (!gpxPts || gpxPts.length < 2) {
      alert("Carica prima una traccia GPX.");
      return;
    }

    let T_target_sec = null;
    const str = document.getElementById("pc_target").value.trim();

    if (/^\d+:\d{2}:\d{2}$/.test(str)) {
      const p = str.split(":");
      T_target_sec = (+p[0])*3600 + (+p[1])*60 + (+p[2]);
    } else {
      alert("Inserisci un tempo obiettivo valido (hh:mm:ss).");
      return;
    }

    const gran = parseInt(document.getElementById("pc_gran").value, 10);

    const params = {
      terrainClass: document.getElementById("terrain").value,
      meteo: readNum("meteo"),
      alt: readNum("alt"),
      spec: readNum("spec")
    };

    PC_PLAN = generatePacingPlan({
      gpxPts,
      metrics,
      params,
      T_target_sec,
      gran_km: gran
    });

    if (PC_PLAN.error) {
      alert(PC_PLAN.error);
      return;
    }

    const distTotal_km = metrics.km;
    const avgPaceSec = T_target_sec / Math.max(1e-6, distTotal_km);

    pc_renderTable(PC_PLAN.pacingChunks, avgPaceSec);
    pc_renderSummary(avgPaceSec);
drawPacingMap(PC_PLAN.pacingChunks, avgPaceSec);
pacingDrawProfile();
pacingAttachEvents();

    document.getElementById("pc_results").style.display = "block";
  });

});