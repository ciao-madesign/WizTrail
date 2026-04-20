"""
Script 04 — Insights Report + Patch JS per WizTrail
Genera:
  output/3_insights_report.md
  output/4_wiztrail_patch.js
  output/plots/insights_*.png
"""
import json, warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path
from datetime import datetime

warnings.filterwarnings("ignore")
DATA_DIR   = Path("data")
OUTPUT_DIR = Path("output")
PLOTS_DIR  = OUTPUT_DIR / "plots"
PLOTS_DIR.mkdir(exist_ok=True)


def load_json(path):
    p = Path(path)
    return json.loads(p.read_text()) if p.exists() else {}


def predict_h(bp, ce, ct, ed, km, gain, tech):
    import math
    return (bp * km / 60.) * (1 + ce * (gain / 1000.)) * \
           (1 + ct * (tech / 10.)) * math.pow(max(km, 1) / 42., ed)


def main():
    df       = pd.read_csv(DATA_DIR / "computed.csv")
    wdi_cal  = load_json(OUTPUT_DIR / "1_wdi_calibration.json")
    pac_cal  = load_json(OUTPUT_DIR / "2_pacing_coefficients.json")
    today    = datetime.now().strftime("%d/%m/%Y")

    # Colonne unificate
    df["km_eff"]   = df["gpx_km"].fillna(df["distance_km"])
    df["gain_eff"] = df["gpx_gain"].fillna(df["elevation_m"])
    df["dplus_per_km"] = df["gain_eff"] / df["km_eff"].clip(lower=1)
    df["race_type"] = df["dplus_per_km"].apply(
        lambda x: "skyrace" if x > 60 else "trail_ultra")

    # ── Insight 1: distribuzione WDI ─────────────────────────────────────────
    wdi_vals = df["wdi_computed"].dropna()
    thresholds = [
        ("Sport",    0,   14),
        ("Pro",      14,  30),
        ("Advanced", 30,  55),
        ("Extreme",  55,  105),
        ("Elite",    105, 165),
        ("Legend",   165, 9999),
    ]
    level_counts = {n: int(((wdi_vals >= lo) & (wdi_vals < hi)).sum())
                    for n, lo, hi in thresholds}

    # ── Insight 2: correlazioni ───────────────────────────────────────────────
    correlations = {}
    pairs = [
        ("distance_km",  "wdi_computed",    "Distanza → WDI"),
        ("elevation_m",  "wdi_computed",    "Dislivello → WDI"),
        ("technicality", "wdi_computed",    "Technicality → WDI"),
        ("technicality", "tech_computed",   "Technicality → TechScore"),
        ("km_eff",       "avg_finish_hours","Distanza → Tempo medio"),
        ("gain_eff",     "avg_finish_hours","Dislivello → Tempo medio"),
        ("technicality", "avg_finish_hours","Technicality → Tempo medio"),
        ("wdi_computed", "avg_finish_hours","WDI → Tempo medio"),
    ]
    for c1, c2, label in pairs:
        if c1 in df.columns and c2 in df.columns:
            d2 = df[[c1, c2]].dropna()
            if len(d2) > 2:
                correlations[label] = round(float(np.corrcoef(d2[c1], d2[c2])[0, 1]), 3)

    corr_tech_wdi = correlations.get("Technicality → WDI", 0.0)

    # ── Insight 3: anomalie ───────────────────────────────────────────────────
    anomaly_tech = df[(df["technicality"] >= 7) & (df["wdi_computed"] < 40)] \
        [["race", "distance_km", "technicality", "wdi_computed"]].copy()
    anomaly_run  = df[(df["technicality"] <= 3.5) & (df["km_eff"] >= 80)] \
        [["race", "km_eff", "technicality", "wdi_computed"]].copy()

    # ── Insight 4: dispersione campo (ratio medio/top) ────────────────────────
    df_r = df.dropna(subset=["avg_finish_hours", "avg_top100_men_hours"]).copy()
    if len(df_r) > 0:
        df_r["ratio"] = df_r["avg_finish_hours"] / df_r["avg_top100_men_hours"]
    else:
        df_r["ratio"] = np.nan

    # ── Insight 5: outlier per categoria ITRA ────────────────────────────────
    if "itra_category" in df.columns:
        cat_mean = df.groupby("itra_category")["wdi_computed"].transform("mean")
        cat_std  = df.groupby("itra_category")["wdi_computed"].transform("std").fillna(1)
        df["wdi_z"] = (df["wdi_computed"] - cat_mean) / cat_std
        outliers = df[df["wdi_z"].abs() > 1.8] \
            [["race", "itra_category", "wdi_computed", "wdi_z"]].copy()
        outliers["wdi_z"] = outliers["wdi_z"].round(2)
    else:
        outliers = pd.DataFrame()

    # ── Grafici ───────────────────────────────────────────────────────────────
    _plot_distribution(level_counts)
    _plot_tech_vs_wdi(df)
    if len(df_r) > 3:
        _plot_spread(df_r)

    # ── Report + Patch ────────────────────────────────────────────────────────
    _write_report(df, today, level_counts, correlations, corr_tech_wdi,
                  anomaly_tech, anomaly_run, outliers, df_r, wdi_cal, pac_cal)
    _write_patch(wdi_cal, pac_cal, today)

    print("  ✓  output/3_insights_report.md")
    print("  ✓  output/4_wiztrail_patch.js")
    print("  ✓  Grafici in output/plots/")

    # Storico run
    save_history(wdi_cal, pac_cal, df)
    plot_history()


# ── Grafici ───────────────────────────────────────────────────────────────────

def _plot_distribution(level_counts):
    colors = ["#2BB7DA","#34A853","#F4C20D","#F79617","#E91E63","#8E24AA"]
    labels = list(level_counts.keys())
    vals   = list(level_counts.values())
    fig, ax = plt.subplots(figsize=(9, 4))
    fig.patch.set_facecolor("#fafafa")
    bars = ax.bar(labels, vals, color=colors, edgecolor="white", linewidth=0.8)
    for bar, v in zip(bars, vals):
        if v > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.1,
                    str(v), ha="center", fontsize=10, fontweight="bold")
    ax.set_title("Distribuzione gare per classe WDI", fontsize=12, fontweight="bold")
    ax.set_ylabel("Numero di gare")
    ax.set_facecolor("#f5f5f5"); ax.grid(axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "insights_distribution.png", dpi=150, bbox_inches="tight")
    plt.close()


def _plot_tech_vs_wdi(df):
    d = df.dropna(subset=["technicality", "wdi_computed", "km_eff"])
    if len(d) < 3: return
    fig, ax = plt.subplots(figsize=(9, 5))
    fig.patch.set_facecolor("#fafafa")
    sc = ax.scatter(d["technicality"], d["wdi_computed"],
                    c=d["km_eff"], cmap="YlOrRd", s=60, alpha=0.78,
                    edgecolors="white", linewidths=0.4)
    cbar = plt.colorbar(sc, ax=ax); cbar.set_label("Distanza (km)")
    # Etichette gare notevoli
    notable = ["UTMB", "Tor des Geants", "Zegama-Aizkorri",
               "Western States 100", "Scotland Skyline 52K", "Tarawera 100K"]
    for _, row in d[d["race"].isin(notable)].iterrows():
        ax.annotate(row["race"][:16], (row["technicality"], row["wdi_computed"]),
                    fontsize=7, alpha=0.7, xytext=(4, 2), textcoords="offset points")
    ax.set_xlabel("Technicality (0–10)"); ax.set_ylabel("WDI calcolato")
    ax.set_title("Technicality vs WDI (colore = distanza)", fontsize=12, fontweight="bold")
    ax.set_facecolor("#f5f5f5"); ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "insights_tech_vs_wdi.png", dpi=150, bbox_inches="tight")
    plt.close()


def _plot_spread(df_r):
    d = df_r.dropna(subset=["ratio"]).sort_values("ratio", ascending=False).head(25)
    if len(d) < 3: return
    fig, ax = plt.subplots(figsize=(10, 6))
    fig.patch.set_facecolor("#fafafa")
    colors = ["#E8593C" if r > 2.5 else "#F4C20D" if r > 1.8 else "#34A853"
              for r in d["ratio"]]
    ax.barh(d["race"].str[:32], d["ratio"], color=colors,
            edgecolor="white", linewidth=0.5)
    ax.axvline(x=2.0, color="#888", linestyle="--", alpha=0.5, lw=1)
    ax.set_xlabel("Rapporto tempo medio / top 100 uomini")
    ax.set_title("Dispersione del campo — Top 25 gare", fontsize=12, fontweight="bold")
    ax.set_facecolor("#f5f5f5"); ax.grid(axis="x", alpha=0.3)
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "insights_spread.png", dpi=150, bbox_inches="tight")
    plt.close()


# ── Report Markdown ───────────────────────────────────────────────────────────

def _write_report(df, today, level_counts, correlations, corr_tech_wdi,
                  anomaly_tech, anomaly_run, outliers, df_r, wdi_cal, pac_cal):
    total = len(df)
    n_gpx = int((df.get("calc_source", pd.Series()) == "gpx").sum())

    # Tabelle
    dist_rows = "\n".join(
        f"| {k} | {v} | {v/total*100:.1f}% |"
        for k, v in level_counts.items() if v > 0)

    corr_rows = "\n".join(
        f"| {k} | {v:+.3f} | {'🟢 Forte' if abs(v)>0.7 else '🟡 Moderata' if abs(v)>0.4 else '⚪ Debole'} |"
        for k, v in correlations.items())

    pac_rows = ""
    for pk, pr in pac_cal.items():
        for ctype, cr in pr.get("clusters", {}).items():
            lbl = pr["label"] + (" [Skyrace]" if ctype == "skyrace" else " [Trail/Ultra]")
            pac_rows += (f"| {lbl} | {cr['base_pace_min_km']:.2f} | "
                         f"{cr['coeff_elev']:.3f} | {cr['coeff_tech']:.3f} | "
                         f"{cr['rmse_hours']:.2f}h | {cr['n_races']} |\n")

    # WDI calibration summary
    if wdi_cal.get("rmse_after"):
        wdi_summary = (
            f"\n| Metrica | Prima | Dopo |\n|---------|-------|------|\n"
            f"| RMSE TechScore | {wdi_cal['rmse_before']:.2f} | {wdi_cal['rmse_after']:.2f} |\n"
            f"| Miglioramento | — | **{wdi_cal['improvement_pct']:+.1f}%** |\n"
            f"| Gare GPX | — | {wdi_cal['n_races_gpx']} |\n"
        )
        tw = wdi_cal.get("tech_score_weights", {})
        wdi_weights_str = (
            f"FRIP={tw.get('w_frip','?')}  SVar={tw.get('w_svar','?')}  "
            f"Rough={tw.get('w_rough','?')}  Vert={tw.get('w_vert','?')}"
        )
    else:
        wdi_summary = f"\n> ⚠️ {wdi_cal.get('note', 'Dati insufficienti')}\n"
        wdi_weights_str = "n/a"

    # Dispersione top
    spread_top = ""
    if "ratio" in df_r.columns:
        top5 = df_r.dropna(subset=["ratio"]).sort_values("ratio", ascending=False).head(5)
        for _, r in top5.iterrows():
            spread_top += (f"- **{r['race']}** — rapporto {r['ratio']:.2f}x "
                           f"(top {r.get('avg_top100_men_hours','?'):.1f}h / "
                           f"medio {r.get('avg_finish_hours','?'):.1f}h)\n")

    anomaly_tech_str = (anomaly_tech.to_string(index=False)
                        if len(anomaly_tech) else "_Nessuna_")
    anomaly_run_str  = (anomaly_run.to_string(index=False)
                        if len(anomaly_run) else "_Nessuna_")
    outlier_str      = (outliers[["race", "itra_category", "wdi_computed", "wdi_z"]].to_string(index=False)
                        if len(outliers) > 0 else "_Nessun outlier significativo_")

    report = f"""# WizTrail — Report di Calibrazione
_Generato il {today} · {total} gare analizzate · {n_gpx} con GPX reale_

---

## 1. Distribuzione difficoltà WDI

| Classe | Gare | % |
|--------|------|---|
{dist_rows}

📊 `output/plots/insights_distribution.png`

---

## 2. Calibrazione TechScore (WDI Engine)

{wdi_summary}
**Nuovi pesi normalizzati:** {wdi_weights_str}

I coefficienti di normalizzazione (`norm_refs`) determinano quando ogni componente
raggiunge il suo valore massimo. Ricalibra ogni volta che aggiungi GPX.

📊 `output/plots/wdi_scatter.png`

---

## 3. Calibrazione modello tempi

Il dataset è stato diviso in due cluster:
- **Skyrace** (D+ per km > 60m): terreno ripido, ritmo molto più lento
- **Trail / Ultra** (D+ per km ≤ 60m): ritmo sostenuto, dipende più dalla distanza

| Profilo | Pace base (min/km) | Coeff. dislivello | Coeff. tecnica | RMSE | Gare |
|---------|-------------------|-------------------|----------------|------|------|
{pac_rows if pac_rows else "_Dati non disponibili_"}

**Come leggere i coefficienti:**
- `pace base`: minuti/km su terreno piano ideale per quel tipo di runner
- `coeff_elev`: ogni 1000m D+ moltiplica il tempo di (1 + coeff)
- `coeff_tech`: un terreno con technicality 10 moltiplica di (1 + coeff)
- Il classificatore skyrace/trail è automatico dal rapporto D+/km

📊 `output/plots/pacing_scatter.png`

---

## 4. Correlazioni chiave

| Relazione | r | Intensità |
|-----------|---|-----------|
{corr_rows if corr_rows else "_Dati insufficienti_"}

La technicality correla con WDI a **{corr_tech_wdi:+.2f}**.
{"Il WDI è ben sensibile alla difficoltà tecnica del terreno." if corr_tech_wdi > 0.5 else "La tecnica pesa meno del previsto nel WDI finale — considera di aumentare kT nell'engine."}

📊 `output/plots/insights_tech_vs_wdi.png`

---

## 5. Pattern e anomalie

### Gare molto tecniche ma WDI basso (skyrace corte)
Queste gare potrebbero essere **sottovalutate** dal WDI:

```
{anomaly_tech_str}
```

> 💡 Le skyrace corte con alta technicality (VK, skyrace ≤25km) beneficerebbero
> di un moltiplicatore apposito. Il flag `isVK` in WizTrail è il punto di ingresso.

### Gare lunghe e corribili (WDI dominato dal volume)
```
{anomaly_run_str}
```

---

## 6. Dispersione del campo

Il rapporto **tempo medio / top 100** misura quanto una gara penalizza i runner medi.

{spread_top if spread_top else "_Dati non disponibili_"}

> 💡 Questo indice è unico a WizTrail — nessun altro calcolatore lo espone.
> Consideralo come **"Indice di accessibilità"** da mostrare nella scheda gara.

📊 `output/plots/insights_spread.png`

---

## 7. Outlier per categoria ITRA

```
{outlier_str}
```

Outlier notevoli = gare atipiche per la loro categoria o potenziali errori nel dataset.

---

## 8. Prossimi passi

### Priorità alta
- [ ] Applicare i coefficienti da `4_wiztrail_patch.js` in `wiztrail-engine.js`
- [ ] Applicare i coefficienti pacing in `wiztrail-pacing.js`
- [ ] Aggiungere GPX reali per le 3 gare ancora mancanti (TGCC, BGUT_2018, TGCM45)

### Priorità media
- [ ] Ricalibra dopo ogni aggiunta di GPX reali (`bash run.sh`)
- [ ] Implementare indice di dispersione del campo nell'UI WizTrail
- [ ] Aggiungere moltiplicatore isVK/skyrace corta per gare <25km con D+/km >60

### Priorità bassa
- [ ] Estendere dataset con nuove gare (obiettivo: 150+ gare)
- [ ] Implementare aggiustamento bayesiano progressivo da feedback utenti

---
_Riesegui `bash run.sh` dopo ogni aggiunta di dati._
"""
    (OUTPUT_DIR / "3_insights_report.md").write_text(report)


# ── Patch JS ──────────────────────────────────────────────────────────────────

def _write_patch(wdi_cal, pac_cal, today):
    lines = []
    lines.append(f"""/**
 * WizTrail — Calibration Patch
 * Generato il {today} da scripts/04_insights.py
 *
 * ISTRUZIONI:
 *   BLOCCO A → incolla in wiztrail-engine.js › buildTechScore()
 *   BLOCCO B → incolla in wiztrail-pacing.js come costanti globali
 */
""")

    # BLOCCO A
    lines.append("// ════════════════════════════════════════════════")
    lines.append("// BLOCCO A — wiztrail-engine.js › buildTechScore()")
    lines.append("// ════════════════════════════════════════════════")
    if wdi_cal.get("tech_score_weights"):
        tw = wdi_cal["tech_score_weights"]
        nr = wdi_cal["norm_refs"]
        lines.append(f"// RMSE: {wdi_cal['rmse_before']} → {wdi_cal['rmse_after']} ({wdi_cal['improvement_pct']:+.1f}%)")
        lines.append(f"// Gare GPX usate: {wdi_cal['n_races_gpx']}")
        lines.append("//")
        lines.append("// Sostituisci i valori in buildTechScore():")
        lines.append(f"//   normFRIP  = clamp(frip      / {nr['frip']},  0, 1);  // era 0.60")
        lines.append(f"//   normSVar  = clamp(slopeVar  / {nr['slope_var']},  0, 1);  // era 0.55")
        lines.append(f"//   normRough = clamp(roughness / {nr['roughness']},  0, 1);  // era 0.35")
        lines.append(f"//   vertInt   = clamp((gain/km)  / {nr['vert']},  0, 1);  // era 150")
        lines.append("//")
        lines.append(f"//   raw = (normFRIP * {tw['w_frip']}   // era 0.45")
        lines.append(f"//         + normSVar  * {tw['w_svar']}  // era 0.35")
        lines.append(f"//         + normRough * {tw['w_rough']}) // era 0.20")
        lines.append(f"//         * {tw['shape_w']}              // era 0.70")
        lines.append(f"//         + vertInt * {tw['w_vert']}     // era 0.30")
        lines.append("//         (tutti i pesi già normalizzati a somma 1)")
    else:
        lines.append(f"// ⚠️  {wdi_cal.get('note', 'GPX insufficienti per la calibrazione')}")

    lines.append("")
    lines.append("// ════════════════════════════════════════════════")
    lines.append("// BLOCCO B — wiztrail-pacing.js › costanti profilo")
    lines.append("// ════════════════════════════════════════════════")
    lines.append("// Classificazione automatica: D+/km > 60 = skyrace, altrimenti trail_ultra")
    lines.append("")

    for pk, pr in pac_cal.items():
        for ctype, cr in pr.get("clusters", {}).items():
            const_name = f"PACING_{pk.upper()}_{ctype.upper()}"
            lines.append(f"// {pr['label']} [{ctype}] — RMSE {cr['rmse_hours']:.2f}h  n={cr['n_races']}")
            lines.append(f"const {const_name} = {{")
            lines.append(f"  basePaceMinKm: {cr['base_pace_min_km']},")
            lines.append(f"  coeffElev:     {cr['coeff_elev']},")
            lines.append(f"  coeffTech:     {cr['coeff_tech']},")
            lines.append(f"  expoDistCorr:  {cr['expo_dist']},")
            lines.append("};")
            lines.append("")

    lines.append("// ── Helper unificato ─────────────────────────────────────────────────")
    lines.append("// Classificazione automatica skyrace/trail dall'input utente")
    lines.append("function estimateFinishHours(profileKey, km, gainM, tech010) {")
    lines.append("  const dkm = gainM / Math.max(km, 1);")
    lines.append("  const raceType = dkm > 60 ? 'skyrace' : 'trail_ultra';")
    lines.append("  const PROFILES = {")
    for pk, pr in pac_cal.items():
        clusters = pr.get("clusters", {})
        sky_k  = f"PACING_{pk.upper()}_SKYRACE"   if "skyrace"     in clusters else "null"
        tra_k  = f"PACING_{pk.upper()}_TRAIL_ULTRA" if "trail_ultra" in clusters else "null"
        lines.append(f"    '{pk}': {{ skyrace: {sky_k}, trail_ultra: {tra_k} }},")
    lines.append("  };")
    lines.append("  const p = (PROFILES[profileKey] || {})[raceType];")
    lines.append("  if (!p) return null;")
    lines.append("  const fEl = 1 + p.coeffElev * (gainM / 1000);")
    lines.append("  const fTe = 1 + p.coeffTech * (tech010 / 10);")
    lines.append("  const fDi = Math.pow(Math.max(km, 1) / 42, p.expoDistCorr);")
    lines.append("  return (p.basePaceMinKm * km / 60) * fEl * fTe * fDi;")
    lines.append("}")
    lines.append("")
    lines.append("// Uso:")
    lines.append("// estimateFinishHours('avg_finish',  101, 6100, 7.5)  // CCC runner medio")
    lines.append("// estimateFinishHours('top100_men',  42,  2700, 7.5)  // Zegama top uomini")

    (OUTPUT_DIR / "4_wiztrail_patch.js").write_text("\n".join(lines))



# ── Storia dei run ─────────────────────────────────────────────────────────────

def save_history(wdi_cal, pac_cal, df):
    """Salva snapshot JSON + copia datata dei grafici in history/."""
    history_dir = Path("history")
    history_dir.mkdir(exist_ok=True)

    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    # Copia datata di tutti i grafici generati
    hist_plots = history_dir / "plots"
    hist_plots.mkdir(exist_ok=True)
    for png in PLOTS_DIR.glob("*.png"):
        if png.name == "history_rmse.png":
            continue  # il grafico storico non si archivia su se stesso
        dest = hist_plots / f"{ts}_{png.name}"
        dest.write_bytes(png.read_bytes())
    n_gpx   = int((df.get("calc_source", pd.Series()) == "gpx").sum()) if "calc_source" in df.columns else 0
    n_total = len(df)

    # Estrai RMSE per profilo pacing
    pacing_rmse = {}
    for pk, pr in pac_cal.items():
        rmse_vals = [cr["rmse_hours"] for cr in pr.get("clusters", {}).values()]
        pacing_rmse[pk] = round(sum(rmse_vals) / len(rmse_vals), 3) if rmse_vals else None

    snapshot = {
        "timestamp":     ts,
        "n_races_total": n_total,
        "n_races_gpx":   n_gpx,
        "wdi_rmse_before": wdi_cal.get("rmse_before"),
        "wdi_rmse_after":  wdi_cal.get("rmse_after"),
        "wdi_improvement_pct": wdi_cal.get("improvement_pct"),
        "wdi_weights":   wdi_cal.get("tech_score_weights"),
        "pacing_rmse":   pacing_rmse,
        "gpx_list":      sorted(df[df.get("calc_source", "") == "gpx"]["race"].tolist())
                         if "calc_source" in df.columns else [],
    }

    out_path = history_dir / f"{ts}_run.json"
    out_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
    print(f"  ✓  Storia salvata → history/{out_path.name}")
    return snapshot


def plot_history():
    """Genera grafico evoluzione RMSE nel tempo da tutti i run salvati."""
    history_dir = Path("history")
    if not history_dir.exists():
        return

    runs = sorted(history_dir.glob("*_run.json"))
    if len(runs) < 2:
        return  # non ha senso con un solo punto

    records = []
    for r in runs:
        try:
            d = json.loads(r.read_text())
            records.append(d)
        except Exception:
            continue

    if not records:
        return

    dates    = [r["timestamp"][:10] for r in records]
    rmse_wdi = [r.get("wdi_rmse_after") for r in records]
    n_gpx    = [r.get("n_races_gpx", 0) for r in records]

    # RMSE pacing avg_finish (media skyrace + trail)
    rmse_pace = [r.get("pacing_rmse", {}).get("avg_finish") for r in records]

    fig, axes = plt.subplots(1, 2, figsize=(13, 4))
    fig.patch.set_facecolor("#fafafa")
    fig.suptitle("Evoluzione modello WizTrail nel tempo", fontsize=13, fontweight="bold")

    x = range(len(dates))

    # WDI RMSE
    ax1 = axes[0]
    valid_wdi = [(i, v) for i, v in enumerate(rmse_wdi) if v is not None]
    if valid_wdi:
        xi, yi = zip(*valid_wdi)
        ax1.plot(xi, yi, "o-", color="#E8593C", lw=2, ms=7)
        for i, v in valid_wdi:
            ax1.annotate(f"{v:.1f}", (i, v), textcoords="offset points",
                         xytext=(0, 8), fontsize=8, ha="center", color="#E8593C")
    ax1.set_xticks(list(x)); ax1.set_xticklabels(dates, rotation=30, ha="right", fontsize=8)
    ax1.set_ylabel("RMSE TechScore"); ax1.set_title("Calibrazione WDI (RMSE ↓ = meglio)")
    ax1.set_facecolor("#f5f5f5"); ax1.grid(alpha=0.3)

    # Pacing RMSE
    ax2 = axes[1]
    valid_pace = [(i, v) for i, v in enumerate(rmse_pace) if v is not None]
    if valid_pace:
        xi, yi = zip(*valid_pace)
        ax2.plot(xi, yi, "o-", color="#3B8BD4", lw=2, ms=7)
        for i, v in valid_pace:
            ax2.annotate(f"{v:.1f}h", (i, v), textcoords="offset points",
                         xytext=(0, 8), fontsize=8, ha="center", color="#3B8BD4")
    ax2.set_xticks(list(x)); ax2.set_xticklabels(dates, rotation=30, ha="right", fontsize=8)
    ax2.set_ylabel("RMSE medio (ore)"); ax2.set_title("Calibrazione tempi — Runner medio (RMSE ↓ = meglio)")
    ax2.set_facecolor("#f5f5f5"); ax2.grid(alpha=0.3)

    plt.tight_layout()
    plots_dir = Path("output") / "plots"
    plots_dir.mkdir(exist_ok=True)
    plt.savefig(plots_dir / "history_rmse.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  ✓  Grafico storico → output/plots/history_rmse.png  ({len(records)} run)")

if __name__ == "__main__":
    main()
