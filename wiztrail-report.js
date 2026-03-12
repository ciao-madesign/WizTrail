/* ==========================================================
   WIZTRAIL REPORT ENGINE
   Fotografia Calcolatore • Import Snapshot • Report Post-Gara
   Tutto lato client, nessun invio dati.
   ========================================================== */


/* ==========================================================
   FASE 1 — Utility di base
   ========================================================== */

// Converte oggetto → JSON leggibile
function toPrettyJSON(obj) {
    return JSON.stringify(obj, null, 2);
}

// Converte oggetto → TXT semplice
function toSimpleTXT(title, obj) {
    let out = `=== ${title} ===\n`;
    for (const key in obj) {
        out += `${key}: ${obj[key]}\n`;
    }
    return out;
}

// Converte array di oggetti → CSV
function toCSV(rows) {
    if (!rows.length) return "";

    const headers = Object.keys(rows[0]);
    const escape = v =>
        (v === null || v === undefined)
            ? ""
            : (typeof v === "string"
                ? (v.includes('"') || v.includes(",") || v.includes("\n")
                    ? `"${v.replace(/"/g, '""')}"`
                    : v)
                : v);

    let csv = headers.join(",") + "\n";
    for (const row of rows) {
        csv += headers.map(h => escape(row[h])).join(",") + "\n";
    }
    return csv;
}

// Download generico
function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}



/* ==========================================================
   FASE 2 — Fotografia Calcolatore (snapshot)
   ========================================================== */

function buildForecastSnapshot() {

    // A) Atleta
    const t10k = document.getElementById("t10k")?.value ?? "";

    // B) Parametri gara
    const dist  = document.getElementById("dist")?.value ?? "";
    const dplus = document.getElementById("dplus")?.value ?? "";
    const alpha = document.getElementById("alpha")?.value ?? "";

    // C) Terreno
    const pct_strada = document.getElementById("p_strada")?.value ?? "";
    const pct_e      = document.getElementById("p_e")?.value ?? "";
    const pct_ee     = document.getElementById("p_ee")?.value ?? "";
    const pct_ea     = document.getElementById("p_ea")?.value ?? "";

    const rall_e  = document.getElementById("c_e")?.value ?? "";
    const rall_ee = document.getElementById("c_ee")?.value ?? "";
    const rall_ea = document.getElementById("c_ea")?.value ?? "";

    // D) Condizioni
    const meteo = document.getElementById("meteo")?.value ?? "";
    const alt   = document.getElementById("alt")?.value ?? "";
    const fatica= document.getElementById("fatica")?.value ?? "";
    const spec  = document.getElementById("spec")?.value ?? "";
    const margin= document.getElementById("margin")?.value ?? "";

    // E) GPX
    const gpxInfo = document.getElementById("gpxInfo")?.textContent ?? "";

    // F) Output stima
    const outFinal = document.getElementById("outFinal")?.textContent ?? "";
    const outLow   = document.getElementById("outLow")?.textContent ?? "";
    const outHigh  = document.getElementById("outHigh")?.textContent ?? "";

    // G) Metadati
    const timestamp = new Date().toISOString();
    const userAgent = navigator.userAgent;

    return {
        type: "wiztrail_forecast_snapshot",
        timestamp,
        userAgent,

        atleta: {
            "Tempo 10 km (mm:ss)": t10k
        },

        gara: {
            "Distanza (km)": dist,
            "D+ (m)": dplus,
            "α (km ogni 100 m D+)": alpha
        },

        terreno: {
            "% Strada": pct_strada,
            "% E": pct_e,
            "% EE": pct_ee,
            "% EA": pct_ea,
            "Rall. E (%)": rall_e,
            "Rall. EE (%)": rall_ee,
            "Rall. EA (%)": rall_ea
        },

        condizioni: {
            "Meteo": meteo,
            "Altitudine": alt,
            "Fatica": fatica,
            "Specificità S": spec,
            "Margine ±%": margin
        },

        gpx: {
            "Info traccia": gpxInfo
        },

        stima: {
            "Tempo stimato": outFinal,
            "Basso": outLow,
            "Alto": outHigh
        }
    };
}



// === Download snapshot ===

function downloadSnapshotJson() {
    const snap = buildForecastSnapshot();
    downloadFile("wiztrail_snapshot.json", toPrettyJSON(snap), "application/json");
}

function downloadSnapshotTxt() {
    const snap = buildForecastSnapshot();

    let txt = "=== WIZTRAIL – FOTOGRAFIA PARAMETRI ===\n\n";

    txt += "[Atleta]\n";
    for (const k in snap.atleta) txt += `${k}: ${snap.atleta[k]}\n`;
    txt += "\n";

    txt += "[Gara]\n";
    for (const k in snap.gara) txt += `${k}: ${snap.gara[k]}\n`;
    txt += "\n";

    txt += "[Terreno]\n";
    for (const k in snap.terreno) txt += `${k}: ${snap.terreno[k]}\n`;
    txt += "\n";

    txt += "[Condizioni]\n";
    for (const k in snap.condizioni) txt += `${k}: ${snap.condizioni[k]}\n`;
    txt += "\n";

    txt += "[Traccia]\n";
    for (const k in snap.gpx) txt += `${k}: ${snap.gpx[k]}\n`;
    txt += "\n";

    txt += "[Stima]\n";
    for (const k in snap.stima) txt += `${k}: ${snap.stima[k]}\n`;
    txt += "\n";

    txt += `Generato: ${snap.timestamp}\n`;

    downloadFile("wiztrail_snapshot.txt", txt, "text/plain");
}

function downloadSnapshotCsv() {
    const snap = buildForecastSnapshot();

    const row = {
        ...snap.atleta,
        ...snap.gara,
        ...snap.terreno,
        ...snap.condizioni,
        ...snap.gpx,
        ...snap.stima,
        "Timestamp": snap.timestamp,
        "User-Agent": snap.userAgent
    };

    downloadFile("wiztrail_snapshot.csv", toCSV([row]), "text/csv");
}



/* ==========================================================
   FASE 4 — Import Snapshot JSON (Calcolatore → Post-gara)
   ========================================================== */

function importSnapshotJson() {

    const fileInput = document.getElementById("postgaraJsonInput");
    if (!fileInput || !fileInput.files.length) {
        alert("Seleziona prima un file JSON.");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);

            if (!data || data.type !== "wiztrail_forecast_snapshot") {
                alert("Questo file non è uno snapshot del calcolatore.");
                return;
            }

            fillPostGaraFieldsFromSnapshot(data);
            alert("Snapshot importato correttamente!");

        } catch (err) {
            alert("Errore nel leggere il file JSON.\n" + err);
        }
    };

    reader.readAsText(file);
}



function fillPostGaraFieldsFromSnapshot(snap) {

    // Distanza e D+
    if (snap.gara) {
        if (snap.gara["Distanza (km)"] !== undefined)
            document.getElementById("pg_dist").value = snap.gara["Distanza (km)"];
        if (snap.gara["D+ (m)"] !== undefined)
            document.getElementById("pg_dplus").value = snap.gara["D+ (m)"];
    }

    // α
    if (snap.gara && snap.gara["α (km ogni 100 m D+)"] !== undefined) {
        document.getElementById("pg_alpha").value = snap.gara["α (km ogni 100 m D+)"];
    }

    // Terreno maggioritario
    if (snap.terreno) {
        const terrDetected = detectTerrainFromSnapshot(snap.terreno);
        if (terrDetected) {
            document.getElementById("pg_terr").value = terrDetected;
        }
    }

    // Meteo, Altitudine
    if (snap.condizioni) {

        const meteoMAP = {
            "1.00": "Fresco",
            "1.02": "Mite",
            "1.04": "Caldo",
            "1.07": "Molto caldo"
        };
        const altMAP = {
            "1.00": "≤500 m",
            "1.01": "500–1000 m",
            "1.02": "1000–1500 m",
            "1.03": "1500–2000 m",
            "1.04": ">2000 m"
        };

        if (snap.condizioni["Meteo"] !== undefined) {
            const v = snap.condizioni["Meteo"];
            if (meteoMAP[v]) document.getElementById("pg_meteo").value = meteoMAP[v];
        }

        if (snap.condizioni["Altitudine"] !== undefined) {
            const v = snap.condizioni["Altitudine"];
            if (altMAP[v]) document.getElementById("pg_alt").value = altMAP[v];
        }
    }

    // Tempo previsto
    if (snap.stima && snap.stima["Tempo stimato"]) {
        document.getElementById("pg_prev").value = snap.stima["Tempo stimato"];
    }
}


function detectTerrainFromSnapshot(terr) {

    let maxVal = -1;
    let maxKey = null;

    const mapping = {
        "% Strada": "Strada",
        "% E": "E",
        "% EE": "EE",
        "% EA": "EA"
    };

    for (const k in mapping) {
        const val = parseFloat(terr[k]);
        if (!isNaN(val) && val > maxVal) {
            maxVal = val;
            maxKey = k;
        }
    }

    return maxKey ? mapping[maxKey] : null;
}



/* ==========================================================
   FASE 5 — Genera Report Post-gara
   ========================================================== */

let postGaraReport = null;


// ================================================
// GENERA REPORT POST-GARA (versione rivista)
// ================================================
function generaReportPostGara() {
    // --- Lettura campi ---
    const idGara   = document.getElementById("pg_idgara").value.trim();
    const dist     = parseFloat(document.getElementById("pg_dist").value);
    const dplus    = parseFloat(document.getElementById("pg_dplus").value);
    const prevTime = document.getElementById("pg_prev").value.trim();
    const realTime = document.getElementById("pg_real").value.trim();

    const slow     = parseFloat(document.getElementById("pg_slow").value);
    const soste    = parseFloat(document.getElementById("pg_soste").value);
    const terr     = document.getElementById("pg_terr").value;        // Strada | E | EE | EA
    const meteo    = document.getElementById("pg_meteo").value;       // Fresco | Mite | Caldo | Molto caldo
    const alt      = document.getElementById("pg_alt").value;         // ≤500 m | 500–1000 m | 1000–1500 m | 1500–2000 m | >2000 m
    const pacing   = document.getElementById("pg_pacing").value;      // regolare | forte | lento
    const alphaUsed= parseFloat(document.getElementById("pg_alpha").value);
    const note     = document.getElementById("pg_note").value.trim();

    // --- Validazione minima ---
    if (!idGara || !prevTime || !realTime || isNaN(dist) || isNaN(dplus)) {
        alert("Compila almeno: Identificativo gara, Distanza, D+, Tempo previsto, Tempo reale.");
        return;
    }
    const prevSec = timeToSec(prevTime);
    const realSec = timeToSec(realTime);
    if (prevSec === null || realSec === null) {
        alert("Formato orario non valido (usa hh:mm:ss).");
        return;
    }

    // --- Delta ---
    const deltaSec = realSec - prevSec;
    const deltaPct = (deltaSec / prevSec) * 100;

    // --- Cause & Suggerimenti (sempre presenti) ---
    const causes = [];
    const sugg   = [];

    // α da rallentamento salita
    if (!isNaN(slow) && slow > 0) {
        const alphaSug = slow / 10; // euristica: 50% rall. → α≈5.0? No: qui α è "km/100m D+" nel calcolatore.
        // Manteniamo la relazione qualitativa come guida all'aumento/diminuzione:
        if (!isNaN(alphaUsed) && alphaSug > alphaUsed) {
            sugg.push(`Aumenta α da ${alphaUsed.toFixed(2)} → ~${alphaSug.toFixed(2)} (in base al rallentamento in salita dichiarato).`);
        } else {
            sugg.push(`Imposta α ~${alphaSug.toFixed(2)} (coerente con il tuo rallentamento in salita).`);
        }
        causes.push("Rallentamento in salita rilevante.");
    } else {
        sugg.push("Se non percepisci cali marcati in salita su percorsi corribili, valuta un α leggermente più basso (es. 0.6–0.8).");
    }

    // Terreno (sempre un messaggio, basato su selezione)
    switch (terr) {
        case "Strada":
            causes.push("Terreno scorrevole (Strada).");
            sugg.push("Riduci o azzera i rallentamenti E/EE/EA; tienili entro 0–3% salvo tratti difficili.");
            break;
        case "E":
            causes.push("Terreno escursionistico facile (E).");
            sugg.push("Applica un rallentamento E ~3–6% per riflettere fondo non asfaltato ma corribile.");
            break;
        case "EE":
            causes.push("Terreno tecnico (EE).");
            sugg.push("Aumenta rallentamento EE verso 10–15% (più sassi/radici → verso l’alto).");
            break;
        case "EA":
            causes.push("Terreno attrezzato/esposto (EA).");
            sugg.push("Imposta rallentamento EA ~20–30% (movimenti lenti, passaggi esposti).");
            break;
        default:
            // Nessuna selezione (evitiamo rumore)
            break;
    }

    // Meteo (sempre un messaggio)
    switch (meteo) {
        case "Fresco":
            causes.push("Condizioni termiche favorevoli (Fresco).");
            sugg.push("Nessuna correzione termica: se avevi impostato caldo, riporta a Fresco/Mite.");
            break;
        case "Mite":
            causes.push("Condizioni miti.");
            sugg.push("Impatto termico modesto: conferma 'Mite' o riduci una tacca se avevi impostato 'Caldo'.");
            break;
        case "Caldo":
            causes.push("Caldo percepito.");
            sugg.push("Imposta 'Caldo' e considera un Margine ±% un po’ più ampio per maggiore incertezza.");
            break;
        case "Molto caldo":
            causes.push("Molto caldo percepito.");
            sugg.push("Imposta 'Molto caldo' e aumenta il Margine ±%; cura idratazione e strategie di raffreddamento.");
            break;
    }

    // Altitudine (sempre un messaggio)
    switch (alt) {
        case "≤500 m":
            causes.push("Quota bassa (≤500 m).");
            sugg.push("Nessuna correzione altitudine: se in previsione avevi quota più alta, riportala giù.");
            break;
        case "500–1000 m":
            causes.push("Quota moderata (500–1000 m).");
            sugg.push("Impatto lieve: conferma impostazione; non servono correzioni aggressive.");
            break;
        case "1000–1500 m":
        case "1500–2000 m":
        case ">2000 m":
            causes.push("Quota significativa (≥1000 m).");
            sugg.push("Imposta una tacca più severa in Altitudine e considera Margine ±% leggermente più alto.");
            break;
    }

    // Pacing (tutte le opzioni)
    switch (pacing) {
        case "forte":
            causes.push("Partenza troppo forte.");
            sugg.push("Parti ai primi 1–2 km al 85–90% del ritmo gara e chiudi con lieve progressione (negative split). Mantieni il tuo passo senza cercare di inseguire chi ti precede se il suo ritmo è più veloce.");
            break;
        case "regolare":
            causes.push("Pacing regolare.");
            sugg.push("Conferma il pacing: puoi valutare di ridurre leggermente il Margine ±% nella previsione.");
            break;
        case "lento":
            causes.push("Partenza troppo prudente.");
            sugg.push("Cerca di entrare più rapidamente in ritmo, senza esagerare. Una volta stabilizzato il passo puoi sempre pianificare una progressione più decisa dopo il primo terzo di gara, oppure mantenere il ritmo senza andare fuori giri");
            break;
        default:
            // nessuna selezione
            break;
    }

    // Soste (sia 0 sia >0)
    if (!isNaN(soste) && soste > 0) {
        causes.push(`Soste totalizzate: ${soste} min`);
        sugg.push("Se punti alla performance, riduci soste o accorciale. Integra con gel e liquidi in autonomia; se punti ad arrivare al traguardo senza cedimenti o infortuni, pianifica le soste nel tempo previsto.");
    } else {
        sugg.push("Soste 0 min: ottimo per performance; su gare lunghe pianifica micro-rifornimenti 'on the move'.");
    }

    // --- Output HTML ---
    let html = `<h3>${idGara}</h3>`;
    html += `<p><b>Tempo previsto:</b> ${prevTime}<br>`;
    html += `<b>Tempo reale:</b> ${realTime}<br>`;
    html += `<b>Scostamento:</b> ${secToTime(deltaSec)} (${deltaPct.toFixed(1)}%)</p>`;

    html += `<h4>Cause probabili</h4><ul>`;
    (causes.length ? causes : ["Nessuna causa evidente."])
        .forEach(c => html += `<li>${c}</li>`);
    html += `</ul>`;

    html += `<h4>Suggerimenti per la prossima previsione</h4><ul>`;
    (sugg.length ? sugg : ["Nessun suggerimento specifico: impostazioni già coerenti."])
        .forEach(s => html += `<li>${s}</li>`);
    html += `</ul>`;

    if (note) html += `<h4>Note</h4><p>${note}</p>`;

    // Render e attiva download
    document.getElementById("pg_output").innerHTML = html;
    document.getElementById("pg_downloads").style.display = "block";

    // Oggetto finale per export (immutato nello schema)
    postGaraReport = {
        type: "wiztrail_postrace_report",
        timestamp: new Date().toISOString(),
        identificativo_gara: idGara,

        dati: {
            distanza_km: dist,
            dplus_m: dplus,
            tempo_previsto: prevTime,
            tempo_reale: realTime,
            scostamento: secToTime(deltaSec),
            scostamento_percentuale: deltaPct.toFixed(1) + "%"
        },

        fattori: {
            rallentamento_salita_pct: isNaN(slow) ? null : slow,
            soste_min: isNaN(soste) ? 0 : soste,
            terreno: terr,
            meteo: meteo,
            altitudine: alt,
            pacing: pacing,
            alpha_usato: isNaN(alphaUsed) ? null : alphaUsed
        },

        suggerimenti: sugg,
        note: note
    };
}



// Utility orarie
function timeToSec(s) {
    const p = s.split(":");
    if (p.length !== 3) return null;
    const h = parseInt(p[0]), m = parseInt(p[1]), sec = parseInt(p[2]);
    if ([h, m, sec].some(x => isNaN(x))) return null;
    return h*3600 + m*60 + sec;
}
function secToTime(sec) {
    const sign = sec < 0 ? "-" : "";
    sec = Math.abs(sec);
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    const s = Math.floor(sec%60);
    return `${sign}${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}



/* ==========================================================
   FASE 6 — Download Report Post-gara
   ========================================================== */

function downloadPgJson() {
    if (!postGaraReport) { alert("Genera prima il report."); return; }
    downloadFile("wiztrail_postgara.json", toPrettyJSON(postGaraReport), "application/json");
}

function downloadPgTxt() {
    if (!postGaraReport) { alert("Genera prima il report."); return; }

    let txt = "=== WIZTRAIL — REPORT POST-GARA ===\n\n";
    txt += `[Identificativo gara]\n${postGaraReport.identificativo_gara}\n\n`;

    txt += "[Dati]\n";
    for (const k in postGaraReport.dati)
        txt += `${k}: ${postGaraReport.dati[k]}\n`;
    txt += "\n";

    txt += "[Fattori dichiarati]\n";
    for (const k in postGaraReport.fattori)
        txt += `${k}: ${postGaraReport.fattori[k]}\n`;
    txt += "\n";

    txt += "[Suggerimenti]\n";
    if (postGaraReport.suggerimenti.length)
        postGaraReport.suggerimenti.forEach(s => txt += `- ${s}\n`);
    else
        txt += "Nessun suggerimento.\n";
    txt += "\n";

    if (postGaraReport.note) {
        txt += `[Note]\n${postGaraReport.note}\n\n`;
    }

    txt += `Generato: ${postGaraReport.timestamp}\n`;

    downloadFile("wiztrail_postgara.txt", txt, "text/plain");
}

function downloadPgCsv() {
    if (!postGaraReport) { alert("Genera prima il report."); return; }

    const row = {
        "Identificativo gara": postGaraReport.identificativo_gara,
        ...postGaraReport.dati,
        ...postGaraReport.fattori,
        "Suggerimenti": postGaraReport.suggerimenti.join(" | "),
        "Note": postGaraReport.note || "",
        "Timestamp": postGaraReport.timestamp
    };

    downloadFile("wiztrail_postgara.csv", toCSV([row]), "text/csv");
}



/* ==========================================================
   FASE 7–8–9 — Collegamento pulsanti + perfezionamenti
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {

    // --- Fotografia Calcolatore ---
   const btnJson = document.getElementById("btnFotoJson");
if (btnJson) btnJson.addEventListener("click", downloadSnapshotJson);


    // --- Import snapshot ---
    const btnImport = document.getElementById("btnImportSnapshot");
    if (btnImport) btnImport.addEventListener("click", importSnapshotJson);


    // --- Genera Report ---
    const btnGen = document.getElementById("btnGeneraReport");
    if (btnGen) btnGen.addEventListener("click", generaReportPostGara);


    // --- Download Report ---
   const pgJson = document.getElementById("btnPgJson");
if (pgJson) pgJson.addEventListener("click", downloadPgJson);

});

/* === Toggle apertura/chiusura lista suggerimenti (versione corretta) === */
document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("calc_tips_toggle");
    const body   = document.getElementById("calc_tips_body");

    if (!toggle || !body) return;

    toggle.addEventListener("click", () => {

        calcTipsOpen = !calcTipsOpen;  // aggiorna stato globale

        if (calcTipsOpen) {
            body.style.display = "block";
            toggle.textContent = "Nascondi suggerimenti";
        } else {
            body.style.display = "none";

            // Conta quanti suggerimenti ci sono nel body
            const count = (body.querySelectorAll("li").length || 0);

            toggle.textContent = count > 0
                ? `Mostra ${count} suggerimenti`
                : "Mostra suggerimenti";
        }
    });
});
/* ==========================================================
   FEATURE 6 — Suggerimenti dinamici (Calcolatore)
   Leggeri, contestuali, max 3 visibili.
   ========================================================== */

// Helpers per lettura input Calcolatore
function _num(id) {
  const el = document.getElementById(id);
  if (!el) return NaN;
  const v = parseFloat(String(el.value).replace(",", "."));
  return isNaN(v) ? NaN : v;
}
function _val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

// Raccoglie i valori correnti del Calcolatore
function _readCalcInputs() {
  return {
    dist:   _num("dist"),
    dplus:  _num("dplus"),
    alpha:  _num("alpha"),
    pS:     _num("p_strada"),
    pE:     _num("p_e"),
    pEE:    _num("p_ee"),
    pEA:    _num("p_ea"),
    cE:     _num("c_e"),
    cEE:    _num("c_ee"),
    cEA:    _num("c_ea"),
    meteo:  _val("meteo"), // "1.00" | "1.02" | "1.04" | "1.07"
    alt:    _val("alt"),   // "1.00" | "1.01" | "1.02" | "1.03" | "1.04"
    S:      _num("spec"),
    margin: _num("margin")
  };
}

// Valuta suggerimenti (ritorna array di {sev:'warn'|'info', text:string})
function _evaluateDynamicTips(x) {
  const tips = [];
  const validDist = !isNaN(x.dist) && x.dist > 0;
  const validDplus = !isNaN(x.dplus) && x.dplus >= 0;
  const pendenza = (validDist && validDplus) ? (x.dplus / x.dist) : NaN; // m/km
  const pctSum = (x.pS || 0) + (x.pE || 0) + (x.pEE || 0) + (x.pEA || 0);
const TERRAIN_LABELS = {
    "Strada": "Molto semplice",
    "E": "Moderata",
    "EE": "Impegnativa",
    "EA": "Molto difficile"
};

// 1) Coerenza percorso (pendenza)
  // Calcolo e guard-rails per evitare suggerimenti prematuri/contraddittori.
  // - Non dare tip di pendenza se D+ è troppo basso o distanza troppo breve
  // - Classi di pendenza mutuamente esclusive (al più 1 tip)
  // - Non dire "scorrevole" se c'è forte tecnicità (EE+EA > 40%)

  const EE_EA_sum = (!isNaN(x.pEE) ? x.pEE : 0) + (!isNaN(x.pEA) ? x.pEA : 0);
  const hasStrongTech = EE_EA_sum > 40;

  if (!isNaN(pendenza)) {
    // Soglia minima di informatività: niente tip di pendenza se D+ < 150 m o dist < 5 km
    const dataInformativi = (x.dplus >= 150) && (x.dist >= 5);

    if (dataInformativi) {
      // Se forte tecnicità, evita di suggerire "scorrevole" anche con pendenza bassa
      if (pendenza < 60 && !hasStrongTech) {
        tips.push({ sev: "info", text: "Percorso scorrevole (≈ <60 m/km): α tipico 0.6–0.8 e penalità tecniche moderate." });
      } else if (pendenza >= 60 && pendenza < 100) {
        tips.push({ sev: "info", text: "Trail moderato (60–100 m/km): α consigliato 0.8–1.0." });
      } else if (pendenza >= 100 && pendenza < 150) {
        tips.push({ sev: "info", text: "Percorso impegnativo (100–150 m/km): valuta α 1.0–1.2 e rallentamenti EE ≥10%." });
      } else if (pendenza >= 150) {
        tips.push({ sev: "warn", text: "Vertical o salite molto dure (≥150 m/km): considera α ≥1.2 e penalità adeguate." });
      }
    }

    // Coerenza pendenza vs Strada (mostra come tip aggiuntivo solo se già c'è un tip di classe)
    if (!isNaN(x.pS) && x.pS > 30 && pendenza > 130 && dataInformativi) {
      tips.push({ sev: "info", text: "Pendenza molto alta ma %Strada >30%: verifica la ripartizione terreni (somma=100%)." });
    }
  }
  // 2) Coerenza α vs D+ e tecnicità
  if (!isNaN(x.dplus) && x.dplus > 1000 && !isNaN(x.alpha) && x.alpha < 0.6) {
    tips.push({ sev: "warn", text: "D+ >1000 m con α <0.6: α probabilmente troppo basso. Suggerito 0.8–1.2." });
  }
  if (x.dplus > 1500 && !isNaN(x.alpha) && x.alpha < 0.9) {
    tips.push({ sev: "warn", text: "Dislivello molto alto: valuta α ≥0.9 per riflettere la fatica in salita." });
  }
  if (x.dplus < 500 && !isNaN(x.alpha) && x.alpha > 1.2) {
    tips.push({ sev: "info", text: "D+ contenuto con α >1.2: potresti ridurre α su percorsi quasi pianeggianti." });
  }
  if (!isNaN(x.pEE) && !isNaN(x.pEA) && (x.pEE + x.pEA > 40) && !isNaN(x.alpha) && x.alpha < 0.8) {
    tips.push({ sev: "warn", text: "Molto terreno tecnico (EE+EA>40%): considera α 0.9–1.1." });
  }

  // 3) Terreno e rallentamenti %
  if (!isNaN(x.pEE) && !isNaN(x.pEA) && (x.pEE + x.pEA > 40) && ( (!isNaN(x.cEE) && x.cEE < 8) || (!isNaN(x.cEA) && x.cEA < 20) )) {
    tips.push({ sev: "warn", text: "EE+EA >40% ma penalità basse: porta EE ~10–15% e EA ~20–30%." });
  }
  if (!isNaN(x.pS) && x.pS > 40 && ( (!isNaN(x.cE) && x.cE > 5) || (!isNaN(x.cEE) && x.cEE > 10) || (!isNaN(x.cEA) && x.cEA > 20) )) {
    tips.push({ sev: "info", text: "Molta Strada (>40%) con penalità alte su E/EE/EA: rischi sovrastima, riducile." });
  }
  if (!isNaN(pctSum) && Math.abs(pctSum - 100) > 1) {
    tips.push({ sev: "warn", text: "La somma dei terreni deve essere 100% (oggi è " + (isNaN(pctSum) ? "N/D" : pctSum + "%") + ")." });
  }
  if (!isNaN(x.pEA) && x.pEA > 0 && (!x.pE || x.pE === 0) && (!x.pEE || x.pEE === 0)) {
    tips.push({ sev: "info", text: "EA >0 senza E/EE: conferma che la maggioranza del tracciato sia davvero attrezzato/esposto." });
  }

  // 4) Specificità (S)
  if (!isNaN(x.S)) {
    if (x.S > 0.8 && ( (!isNaN(x.pEE) && !isNaN(x.pEA) && x.pEE + x.pEA > 40) || (!isNaN(x.alpha) && x.alpha > 1) )) {
      tips.push({ sev: "info", text: "Familiarità molto alta su percorso impegnativo: sei davvero così abituato a questo contesto?" });
    }
    if (!isNaN(pendenza) && pendenza > 100 && x.S < 0.3) {
      tips.push({ sev: "info", text: "Se hai poca familiarità su questo tipo ti terreno, valuta un Margine ±% più ampio." });
    }
  }

  // 5) Margine ±%
  if (!isNaN(x.margin)) {
    if (x.margin < 5 && ( (!isNaN(pendenza) && pendenza > 80) || (!isNaN(x.pEE) && !isNaN(x.pEA) && (x.pEE + x.pEA > 25)) )) {
      tips.push({ sev: "warn", text: "Per un trail così variabile è consigliato un margine di 8–12%." });
    }
    if (x.S > 0.7 && x.margin > 10) {
      tips.push({ sev: "info", text: "Se hai buona familiarità con questo tipo di gara puoi pensare di ridurre leggermente il Margine ±% e avere  una stima più precisa." });
    }
  }

  // Rimuovi duplicati testuali (se capita di colpire più regole con messaggi simili)
  const seen = new Set();
  return tips.filter(t => { const k = t.sev + "|" + t.text; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Rendering
let calcTipsOpen = false;  // stato apertura/chiusura suggerimenti
function _renderDynamicTips(tips) {
  const wrap   = document.getElementById("calc_tips");
  const body   = document.getElementById("calc_tips_body");
  const toggle = document.getElementById("calc_tips_toggle");

  if (!wrap || !body || !toggle) return;

  // Se non ci sono suggerimenti → nascondi tutto
  if (!tips.length) {
    wrap.style.display = "none";
    body.innerHTML = "";
    toggle.textContent = "Mostra suggerimenti";
    calcTipsOpen = false;
    return;
  }

  // Ordina e limita a max 3 suggerimenti
  const order = { warn: 0, info: 1 };
  const top = tips.sort((a,b) => order[a.sev] - order[b.sev]).slice(0, 3);

  // Rendering lista
  const html = `<ul class="tips-list">` + top.map(t => {
    const ico = t.sev === "warn" ? "⚠️" : "💡";
    return `<li class="${t.sev}"><span class="tip-ico">${ico}</span>${t.text}</li>`;
  }).join("") + `</ul>`;

  body.innerHTML = html;
  wrap.style.display = "block";

  // Applica stato attuale (non lo sovrascrive)
  if (calcTipsOpen) {
    body.style.display = "block";
    toggle.textContent = `Nascondi suggerimenti`;
  } else {
    body.style.display = "none";
    toggle.textContent = `Mostra ${top.length} suggerimenti`;
  }
}
// Debounce leggero per non “spammare” il DOM
function _debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
const updateDynamicTips = _debounce(() => {
  const inputs = _readCalcInputs();
  const tips = _evaluateDynamicTips(inputs);
  _renderDynamicTips(tips);
}, 120);

// Hook agli input del Calcolatore
document.addEventListener("DOMContentLoaded", () => {
  const ids = [
    "dist","dplus","alpha",
    "p_strada","p_e","p_ee","p_ea",
    "c_e","c_ee","c_ea",
    "meteo","alt","spec","margin"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input",  updateDynamicTips);
      el.addEventListener("change", updateDynamicTips);
    }
  });

  // Primo render
  updateDynamicTips();
});
/* ==========================================================
   FEATURE GPX POST-GARA — Import traccia reale
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btnPgImportGpx");
    if (!btn) return;

    btn.addEventListener("click", () => {
        const input = document.getElementById("pg_gpx_file");
        if (!input || !input.files.length) {
            alert("Seleziona una traccia GPX o TCX.");
            return;
        }

        const file = input.files[0];
        const reader = new FileReader();

        reader.onload = (e) => {
            const xmlText = e.target.result;
            const xml = new DOMParser().parseFromString(xmlText, "text/xml");

            let pts = [];
            let timeStart = null;
            let timeEnd = null;

            // ---- GPX ----
            if (xml.getElementsByTagName("trkpt").length > 0) {
                const trackpts = xml.getElementsByTagName("trkpt");
                for (let i = 0; i < trackpts.length; i++) {
                    const lat = parseFloat(trackpts[i].getAttribute("lat"));
                    const lon = parseFloat(trackpts[i].getAttribute("lon"));
                    const eleEl = trackpts[i].getElementsByTagName("ele")[0];
                    const timeEl = trackpts[i].getElementsByTagName("time")[0];
                    const ele = eleEl ? parseFloat(eleEl.textContent) : 0;
                    const t = timeEl ? new Date(timeEl.textContent).getTime() : null;

                    if (!isNaN(lat) && !isNaN(lon)) {
                        pts.push({ lat, lon, ele, t });

                        if (t) {
                            if (!timeStart) timeStart = t;
                            timeEnd = t;
                        }
                    }
                }
            }

            // ---- TCX ----
            if (xml.getElementsByTagName("Trackpoint").length > 0) {
                const trackpts = xml.getElementsByTagName("Trackpoint");
                for (let i = 0; i < trackpts.length; i++) {
                    const latEl = trackpts[i].getElementsByTagName("LatitudeDegrees")[0];
                    const lonEl = trackpts[i].getElementsByTagName("LongitudeDegrees")[0];
                    const eleEl = trackpts[i].getElementsByTagName("AltitudeMeters")[0];
                    const timeEl = trackpts[i].getElementsByTagName("Time")[0];

                    if (!latEl || !lonEl) continue;

                    const lat = parseFloat(latEl.textContent);
                    const lon = parseFloat(lonEl.textContent);
                    const ele = eleEl ? parseFloat(eleEl.textContent) : 0;
                    const t = timeEl ? new Date(timeEl.textContent).getTime() : null;

                    if (!isNaN(lat) && !isNaN(lon)) {
                        pts.push({ lat, lon, ele, t });

                        if (t) {
                            if (!timeStart) timeStart = t;
                            timeEnd = t;
                        }
                    }
                }
            }

            if (pts.length < 2) {
                alert("Impossibile leggere la traccia: pochi punti rilevati.");
                return;
            }

            // --- calcolo distanza e D+ ---
            let dist = 0;
            let dplus = 0;

            function hav(a,b){
                const R = 6371e3;
                const toRad = d=> d*Math.PI/180;
                return 2 * R * Math.asin(
                    Math.sqrt(
                        Math.sin((toRad(b.lat)-toRad(a.lat))/2)**2 +
                        Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat)) *
                        Math.sin((toRad(b.lon)-toRad(a.lon))/2)**2
                    )
                );
            }

            for (let i=1; i<pts.length; i++) {
                dist += hav(pts[i-1], pts[i]);

                const delta = pts[i].ele - pts[i-1].ele;
                if (delta > 1) dplus += delta;
            }

            const distKm = dist / 1000;

            // --- tempo totale ---
            let realTime = "";
            if (timeStart && timeEnd) {
                const sec = Math.round((timeEnd - timeStart) / 1000);
                const h = Math.floor(sec/3600);
                const m = Math.floor((sec%3600)/60);
                const s = sec % 60;
                realTime = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
            }

            // --- Compila il Post-gara ---
            document.getElementById("pg_dist").value = distKm.toFixed(2);
            document.getElementById("pg_dplus").value = Math.round(dplus);

            if (realTime) {
                document.getElementById("pg_real").value = realTime;
            }

            alert("Traccia importata correttamente!");
        };

        reader.readAsText(file);
    });
});