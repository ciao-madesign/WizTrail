/***************************************************************
 *  WIZTRAIL — POST-GARA ENGINE 2026
 ***************************************************************/

/*** UTILS ***/
function pg_parseHMS(str) {
  if (!/^\d+:\d{2}:\d{2}$/.test(str)) return null;
  const [h, m, s] = str.split(":").map(Number);
  return h*3600 + m*60 + s;
}

function pg_secToHMS(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

/***************************************************************
 *  COMMENTO INTELLIGENTE
 ***************************************************************/
function pg_generateComment({ deltaPerc, terr, met, pac, soste }) {

  let comment = [];

  /* 1) Delta prestazione */
  if (deltaPerc < -5) {
    comment.push("Prestazione eccellente: hai corso più veloce del previsto. Segno di forma superiore alle attese.");
  } 
  else if (deltaPerc <= 5) {
    comment.push("Ottima coerenza: il risultato è molto vicino alla previsione, la strategia di gara sembra ben calibrata.");
  }
  else if (deltaPerc <= 12) {
    comment.push("Leggera differenza rispetto alla previsione: performance comunque buona, con piccoli margini di miglioramento.");
  }
  else {
    comment.push("Differenza significativa rispetto alla previsione: la gara è risultata più difficile del previsto.");
  }

  /* 2) Meteo */
  if (met === "Caldo" || met === "Molto caldo") {
    comment.push("Il caldo percepito può aver influito sulla gestione del ritmo e sul consumo energetico.");
  } 
  else if (met === "Fresco") {
    comment.push("Le condizioni fresche erano favorevoli: eventuali difficoltà non sono legate al meteo.");
  }

  /* 3) Terreno */
  if (terr === "EA") {
    comment.push("Terreno molto tecnico: questo può giustificare parte dello scostamento rispetto alla previsione.");
  } 
  else if (terr === "EE") {
    comment.push("Terreno tecnicamente impegnativo: probabile impatto sul passo soprattutto in discesa.");
  } 
  else if (terr === "Strada" || terr === "E") {
    if (deltaPerc > 8) {
      comment.push("Il terreno era relativamente semplice: lo scostamento potrebbe indicare stanchezza o una gestione del ritmo migliorabile.");
    }
  }

  /* 4) Pacing */
  if (pac === "forte") {
    comment.push("La partenza troppo forte probabilmente ha provocato un calo nella seconda parte di gara.");
  } 
  else if (pac === "lento") {
    comment.push("Partenza prudente: entrare in ritmo più velocemente potrebbe migliorare la performance.");
  } 
  else {
    comment.push("Pacing costante: buona gestione dello sforzo.");
  }

  /* 5) Soste */
  const sNum = Number(soste);
  if (sNum && sNum >= 8) {
    comment.push("Le soste totali hanno inciso in modo significativo sul tempo finale.");
  } 
  else if (sNum && sNum > 0) {
    comment.push("Le soste hanno avuto un impatto moderato sulla performance.");
  }

  return comment.join(" ");
}


/***************************************************************
 *  IMPORT JSON SNAPSHOT
 ***************************************************************/
document.getElementById("btnImportSnapshot")?.addEventListener("click", async () => {
  const inp = document.getElementById("postgaraJsonInput");
  const f = inp.files?.[0];
  if (!f) { alert("Seleziona un file JSON."); return; }

  const txt = await f.text();
  const data = JSON.parse(txt);

  if (data.distance_km) document.getElementById("pg_dist").value = data.distance_km;
  if (data.d_plus_m)   document.getElementById("pg_dplus").value = data.d_plus_m;
  if (data.risultato?.tempo_finale)
      document.getElementById("pg_prev").value = data.risultato.tempo_finale;

  alert("Riepilogo importato.");
});


/***************************************************************
 *  IMPORT GPX REALE
 ***************************************************************/
document.getElementById("btnPgImportGpx")?.addEventListener("click", async () => {
  const inp = document.getElementById("pg_gpx_file");
  const f = inp.files?.[0];
  if (!f) { alert("Seleziona un file GPX."); return; }

  const txt = await f.text();
  const xml = new DOMParser().parseFromString(txt,"application/xml");

  const pts = parseTrack(xml);
  const mt  = compute(pts);

  document.getElementById("pg_dist").value  = mt.km.toFixed(3);
  document.getElementById("pg_dplus").value = mt.gain;

  alert("Dati reali GPX importati.");
});


/***************************************************************
 *  GENERA REPORT
 ***************************************************************/
document.getElementById("btnGeneraReport")?.addEventListener("click", () => {

  const idGara = document.getElementById("pg_idgara").value.trim();
  const dist   = document.getElementById("pg_dist").value.trim();
  const dplus  = document.getElementById("pg_dplus").value.trim();
  const prev   = document.getElementById("pg_prev").value.trim();
  const real   = document.getElementById("pg_real").value.trim();
  const soste  = document.getElementById("pg_soste").value.trim();

  if (!idGara) { alert("Inserisci un nome gara."); return; }

  const prevSec = pg_parseHMS(prev);
  const realSec = pg_parseHMS(real);

  if (prevSec === null || realSec === null) {
    alert("Inserisci tempi validi (hh:mm:ss).");
    return;
  }

  const delta     = realSec - prevSec;
  const deltaPerc = (delta / prevSec) * 100;

  const terr = document.getElementById("pg_terr").value;
  const met  = document.getElementById("pg_meteo").value;
  const pac  = document.getElementById("pg_pacing").value;
  const note = document.getElementById("pg_note").value;

  const commento = pg_generateComment({
    deltaPerc,
    terr,
    met,
    pac,
    soste
  });

  const out = document.getElementById("pg_output");
  out.innerHTML = `
    <h3>Risultato gara</h3>
    <p><b>${idGara}</b></p>

    <p><b>Distanza reale:</b> ${dist} km <br>
       <b>D+ reale:</b> ${dplus} m</p>

    <p><b>Tempo previsto:</b> ${prev}<br>
       <b>Tempo reale:</b> ${real}</p>

    <p><b>Delta:</b> ${delta>=0?"+":""}${delta.toFixed(0)} s (${deltaPerc.toFixed(2)}%)</p>

    <p><b>Soste:</b> ${soste} min</p>

    <p><b>Terreno percepito:</b> ${terr}<br>
       <b>Meteo percepito:</b> ${met}<br>
       <b>Pacing percepito:</b> ${pac}</p>

    <p><b>Note atleta:</b> ${note || "-"}</p>

    <hr>
    <h3>Commento</h3>
    <p>${commento}</p>
  `;

  document.getElementById("pg_downloads").style.display = "block";

  window.PG_REPORT = {
    idGara, dist, dplus,
    previsto: prev, reale: real,
    delta_sec: delta,
    delta_perc: deltaPerc,
    soste,
    terreno: terr,
    meteo: met,
    pacing: pac,
    note,
    commento,
    timestamp: new Date().toISOString()
  };
});


/***************************************************************
 *  DOWNLOAD JSON
 ***************************************************************/
document.getElementById("btnPgJson")?.addEventListener("click", () => {

  if (!window.PG_REPORT) {
    alert("Genera prima il report.");
    return;
  }

  const blob = new Blob(
    [JSON.stringify(window.PG_REPORT, null, 2)],
    {type:"application/json"}
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wiztrail-report-postgara.json";
  a.click();
});