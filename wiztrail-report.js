/***************************************************************
 *  WIZTRAIL – REPORT POST-GARA (versione aggiornata 2026)
 *  - RIMOSSI: α, altitudine percepita, rallentamento in salita
 *  - AGGIUNTO: differenza tempo/km (previsto vs reale)
 *  - AGGIUNTI: suggerimenti dinamici
 *  - PULITO: nessun campo inutile
 ***************************************************************/

/* ========= UTILITIES ========= */

const _fmtHMS = sec => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};

const _fmtPace = secPerKm => {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "—";
  const mm = Math.floor(secPerKm / 60);
  const ss = Math.round(secPerKm % 60);
  return `${mm}:${String(ss).padStart(2,'0')}/km`;
};

const _parseHMS = str => {
  if (!str || !/^\d+:\d{2}:\d{2}$/.test(str)) return NaN;
  const p = str.split(":");
  return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
};

/***************************************************************
 *  IMPORT SNAPSHOT JSON
 ***************************************************************/
document.getElementById("btnImportSnapshot").addEventListener("click", async () => {
  const f = document.getElementById("postgaraJsonInput").files[0];
  if (!f) return alert("Seleziona un file JSON.");

  try {
    const txt = await f.text();
    const snap = JSON.parse(txt);

    if (snap.dist)  document.getElementById("pg_dist").value  = snap.dist;
    if (snap.dplus) document.getElementById("pg_dplus").value = snap.dplus;
    if (snap.T_final_hms) document.getElementById("pg_prev").value = snap.T_final_hms;

    alert("Snapshot importato.");
  } catch {
    alert("JSON non valido.");
  }
});

/***************************************************************
 *  IMPORT GPX POST-GARA
 ***************************************************************/
function pg_parseTrack(xml){
  const pts=[];
  const g=xml.getElementsByTagName("trkpt");
  if (g.length){
    [...g].forEach(n=>{
      const la=parseFloat(n.getAttribute("lat"));
      const lo=parseFloat(n.getAttribute("lon"));
      const e=n.getElementsByTagName("ele")[0];
      pts.push([la,lo,e?parseFloat(e.textContent):0]);
    });
    return pts;
  }
  const t=xml.getElementsByTagName("Trackpoint");
  [...t].forEach(n=>{
    const p=n.getElementsByTagName("Position")[0];
    if(!p)return;
    const la=p.getElementsByTagName("LatitudeDegrees")[0];
    const lo=p.getElementsByTagName("LongitudeDegrees")[0];
    const el=n.getElementsByTagName("AltitudeMeters")[0];
    pts.push([
      la?parseFloat(la.textContent):0,
      lo?parseFloat(lo.textContent):0,
      el?parseFloat(el.textContent):0
    ]);
  });
  return pts;
}

function pg_hav(a,b,c,d){
  const R=6371000, t=Math.PI/180;
  const dLat=(c-a)*t, dLon=(d-b)*t;
  const k=Math.sin(dLat/2)**2 +
          Math.cos(a*t)*Math.cos(c*t)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(k));
}

function pg_compute(pts){
  if(pts.length<2) return {km:0,gain:0};
  let dist=0,gain=0;
  for(let i=1;i<pts.length;i++){
    const dd = pg_hav(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1]);
    if(dd<300) dist+=dd;
    const de = pts[i][2]-pts[i-1][2];
    if(de>1) gain+=de;
  }
  return { km: dist/1000, gain };
}

document.getElementById("btnPgImportGpx").addEventListener("click", async () => {
  const f = document.getElementById("pg_gpx_file").files[0];
  if (!f) return alert("Seleziona un file GPX/TCX.");

  try{
    const txt = await f.text();
    const xml = new DOMParser().parseFromString(txt,"application/xml");
    const pts = pg_parseTrack(xml);
    const info = pg_compute(pts);

    document.getElementById("pg_dist").value  = info.km.toFixed(3);
    document.getElementById("pg_dplus").value = info.gain;

    alert("Distanza e D+ reali importati.");
  }catch{
    alert("Errore lettura GPX.");
  }
});

/***************************************************************
 *  SUGGERIMENTI DINAMICI
 ***************************************************************/
function pg_generateTips(rep){
  const tips = [];

  /* TEMPO (delta totale) */
  if (rep.delta_sec > 600)
    tips.push("La gara è risultata più lenta del previsto: prova a rivalutare tecnicità, meteo o strategie di pacing.");
  else if (rep.delta_sec < -600)
    tips.push("Hai corso più veloce della previsione: i parametri del Calcolatore potrebbero essere troppo conservativi.");
  else
    tips.push("La previsione era ben calibrata.");

  /* METEO */
  if (rep.meteo === "Caldo" || rep.meteo === "Molto caldo")
    tips.push("Il caldo ha un impatto forte sui ritmi: considera una penalità meteo maggiore la prossima volta.");

  /* TERRENO */
  if (rep.terreno === "EE" || rep.terreno === "EA")
    tips.push("Terreno molto tecnico: aumenta le percentuali di EE/EA e le relative penalità nella prossima previsione.");
  else if (rep.terreno === "Strada")
    tips.push("Terreno più scorrevole del previsto: valuta penalità tecniche più leggere.");

  /* PACING PERCEPITO */
  if (rep.pacing === "forte")
    tips.push("Nella prossima gara cerca di impostare un pacing iniziale più conservativo, evita di 'inseguire' runners più veloci, mantieni il tuo ritmo: se avrai energie potrai aumentare dopo la metà gara (negative split).");
  else if (rep.pacing === "lento")
    tips.push("Partenza troppo prudente? potresti permetterti un avvio leggermente più veloce per entrare in ritmo più rapidamente e non perdere il treno dei runner più veloci.");

  /* SOSTE */
  if (rep.soste_min > 0)
    tips.push(`Le soste totali (${rep.soste_min} min) hanno influito sul tempo finale: considerale nella prossima previsione.`);

  return tips;
}

/***************************************************************
 *  GENERA REPORT
 ***************************************************************/
document.getElementById("btnGeneraReport").addEventListener("click", () => {

  const idgara = document.getElementById("pg_idgara").value.trim();
  const dist   = parseFloat(document.getElementById("pg_dist").value)  || 0;
  const dplus  = parseFloat(document.getElementById("pg_dplus").value) || 0;

  const prevStr = document.getElementById("pg_prev").value.trim();
  const realStr = document.getElementById("pg_real").value.trim();

  const prevSec = _parseHMS(prevStr);
  const realSec = _parseHMS(realStr);

  const soste  = parseFloat(document.getElementById("pg_soste").value) || 0;
  const terr   = document.getElementById("pg_terr").value;
  const meteo  = document.getElementById("pg_meteo").value;
  const pacing = document.getElementById("pg_pacing").value;
  const note   = document.getElementById("pg_note").value.trim();

  if (!idgara) return alert("Inserisci un identificativo gara.");
  if (!prevStr || isNaN(prevSec)) return alert("Tempo previsto non valido.");
  if (!realStr || isNaN(realSec)) return alert("Tempo reale non valido.");

  const deltaSec = realSec - prevSec;
  const deltaPct = (deltaSec / prevSec) * 100;

  /* DIFFERENZA TEMPO/KM */
  const pacePrev = prevSec / Math.max(dist, 0.0001);
  const paceReal = realSec / Math.max(dist, 0.0001);
  const paceDiff = paceReal - pacePrev;

  /* COSTRUZIONE OGGETTO */
  const rep = window._wiztrail_last_report = {
    idgara,
    dist_km: dist,
    dplus,
    previsto_hms: prevStr,
    previsto_sec: prevSec,
    reale_hms: realStr,
    reale_sec: realSec,
    delta_sec: deltaSec,
    delta_pct: deltaPct,
    pace_prev_sec: pacePrev,
    pace_real_sec: paceReal,
    pace_diff_sec: paceDiff,
    terreno: terr,
    meteo,
    pacing,
    soste_min: soste,
    note
  };

  const tips = pg_generateTips(rep);

  /* OUTPUT HTML */
  const out = document.getElementById("pg_output");
  out.innerHTML = `
    <h3>Risultato</h3>
    <p><b>Identificativo gara:</b> ${idgara}</p>
    <p><b>Distanza reale:</b> ${dist.toFixed(2)} km</p>
    <p><b>D+ reale:</b> ${dplus} m</p>

    <p><b>Tempo previsto:</b> ${prevStr}</p>
    <p><b>Tempo reale:</b> ${realStr}</p>

    <p><b>Differenza totale:</b> ${deltaSec>0?"+":""}${_fmtHMS(Math.abs(deltaSec))} (${deltaPct.toFixed(1)}%)</p>

    <hr>

    <h4>Passo (previsto vs reale)</h4>
    <p><b>Pace previsto:</b> ${_fmtPace(pacePrev)}</p>
    <p><b>Pace reale:</b> ${_fmtPace(paceReal)}</p>
    <p><b>Differenza pace:</b> ${paceDiff>0?"+":""}${_fmtPace(Math.abs(paceDiff))}</p>

    <hr>

    <h4>Fattori percepiti</h4>
    <p><b>Terreno:</b> ${terr}</p>
    <p><b>Meteo:</b> ${meteo}</p>
    <p><b>Pacing percepito:</b> ${pacing}</p>
    <p><b>Soste totali:</b> ${soste} min</p>
    ${note ? `<p><b>Note:</b> ${note}</p>` : ""}
  `;

  /* SUGGERIMENTI */
  if (tips.length > 0) {
    out.innerHTML += `
      <hr>
      <h4>Suggerimenti</h4>
      <ul class="mini">
        ${tips.map(t => `<li>${t}</li>`).join("")}
      </ul>
    `;
  }

  document.getElementById("pg_downloads").style.display = "block";
});

/***************************************************************
 *  DOWNLOAD REPORT JSON
 ***************************************************************/
document.getElementById("btnPgJson").addEventListener("click", () => {
  const rep = window._wiztrail_last_report;
  if (!rep) return alert("Genera prima il report.");

  const blob = new Blob([JSON.stringify(rep, null, 2)], {
    type: "application/json"
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wiztrail_report.json";
  a.click();
});