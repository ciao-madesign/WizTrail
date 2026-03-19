/***************************************************************
 *  WIZTRAIL — PACING PLANNER 2026 (compatibile con index nuovo)
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
 *  COSTO LOCALE SEGMENTO
 ***************************************************************/
function pc_segmentCost(seg, params) {

  const dist = seg.dist_m;

  const slope = (seg.elev_diff ?? 0) / Math.max(dist, 1);
  const K_UP = 25, K_DOWN = 8;

  let slopeF = 1;
  if (slope > 0) slopeF = 1 + slope * K_UP;
  else if (slope < 0) slopeF = 1 + Math.abs(slope) * K_DOWN;

  const pS  = (params.pS  ?? 0) / 100;
  const pE  = (params.pE  ?? 0) / 100;
  const pEE = (params.pEE ?? 0) / 100;
  const pEA = (params.pEA ?? 0) / 100;

  const cE  = (params.cE  ?? 0) / 100;
  const cEE = (params.cEE ?? 0) / 100;
  const cEA = (params.cEA ?? 0) / 100;

  const terrF =
    pS  * 1 +
    pE  * (1 + cE) +
    pEE * (1 + cEE) +
    pEA * (1 + cEA);

  const meteo = pc_safeNum(params.meteo ?? 1);
  const alt   = pc_safeNum(params.alt ?? 1);
  const fat   = pc_safeNum(params.fatica ?? 1);
  const S     = pc_safeNum(params.spec ?? 0);

  const totalDist = params.totalDistance_m ?? 1;
  const frac = seg.endDist_m / totalDist;

  let fatProg = 1;
  if (frac > 0.4)
    fatProg = 1 + (fat - 1) * ((frac - 0.4) / 0.6);

  const raw = meteo * alt * fatProg;

  const gamma = 0.75;
  const specAdj = Math.max(1, 1 + (raw - 1) * Math.pow(1 - S, gamma));

  return dist * slopeF * terrF * specAdj;
}

/***************************************************************
 *  COSTI TOTALI
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
 *  MODELLO LOCALE TEMPI PER TRATTO
 ***************************************************************/
function computeChunkTimes(pacingChunks, params, T_target_sec) {

  function baseVelocity10k() {
    const t10 = params.t10_sec;
    return 10000 / t10;
  }

  const v10 = baseVelocity10k();
  let sumLocal = 0;

  pacingChunks.forEach(chunk => {
    const dist_m = chunk.dist_km * 1000;
    const t_base = dist_m / v10;

    const cost_local_avg = chunk.totalCost / Math.max(dist_m, 1);
    chunk.time_raw = t_base * cost_local_avg;

    sumLocal += chunk.time_raw;
  });

  const k = T_target_sec / sumLocal;
  let cumulative = 0;

  pacingChunks.forEach(chunk => {
    chunk.time_sec = chunk.time_raw * k;
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
      pS:  readNum("p_strada"),
      pE:  readNum("p_e"),
      pEE: readNum("p_ee"),
      pEA: readNum("p_ea"),
      cE:  readNum("c_e"),
      cEE: readNum("c_ee"),
      cEA: readNum("c_ea"),
      meteo: readNum("meteo"),
      alt:   readNum("alt"),
      fatica: readNum("fatica"),
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

    document.getElementById("pc_results").style.display = "block";
  });

});