"""
Script 04 — Insights Report + Patch JS per WizTrail
Genera:
  output/3_insights_report.md
  output/4_wiztrail_patch.js
  output/plots/insights_*.png
"""
import json, math, warnings
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


def main():
    df       = pd.read_csv(DATA_DIR / "computed.csv")
    wdi_cal  = load_json(OUTPUT_DIR / "1_wdi_calibration.json")
    pac_cal  = load_json(OUTPUT_DIR / "2_pacing_coefficients.json")
    today    = datetime.now().strftime("%d/%m/%Y")

    df["km_eff"]   = df["gpx_km"].fillna(df["distance_km"])
    df["gain_eff"] = df["gpx_gain"].fillna(df["elevation_m"])
    df["dplus_per_km"] = df["gain_eff"] / df["km_eff"].clip(lower=1)
    df["race_type"] = df["dplus_per_km"].apply(
        lambda x: "skyrace" if x > 60 else "trail_ultra")

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

    anomaly_tech = df[(df["technicality"] >= 7) & (df["wdi_computed"] < 40)] \
        [["race", "distance_km", "technicality", "wdi_computed"]].copy()
    anomaly_run  = df[(df["technicality"] <= 3.5) & (df["km_eff"] >= 80)] \
        [["race", "km_eff", "technicality", "wdi_computed"]].copy()

    df_r = df.dropna(subset=["avg_finish_hours", "avg_top100_men_hours"]).copy()
    if len(df_r) > 0:
        df_r["ratio"] = df_r["avg_finish_hours"] / df_r["avg_top100_men_hours"]
    else:
        df_r["ratio"] = np.nan

    if "itra_category" in df.columns:
        cat_mean = df.groupby("itra_category")["wdi_computed"].transform("mean")
        cat_std  = df.groupby("itra_category")["wdi_computed"].transform("std").fillna(1)
        df["wdi_z"] = (df["wdi_computed"] - cat_mean) / cat_std
        outliers = df[df["wdi_z"].abs() > 1.8] \
            [["race", "itra_category", "wdi_computed", "wdi_z"]].copy()
        outliers["wdi_z"] = outliers["wdi_z"].round(2)
    else:
        outliers = pd.DataFrame()

    _plot_distribution(level_counts)
    _plot_tech_vs_wdi(df)
    if len(df_r) > 3:
        _plot_spread(df_r)

    _write_report(df, today, level_counts, correlations, corr_tech_wdi,
                  anomaly_tech, anomaly_run, outliers, df_r, wdi_cal, pac_cal)
    _write_patch(wdi_cal, pac_cal, today)

    print("  ✓  output/3_insights_report.md")
    print("  ✓  output/4_wiztrail_patch.js")
    print("  ✓  Grafici in output/plots/")

    save_history(wdi_cal, pac_cal, df)
    plot_history()


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


def _pac_summary_rows(pac_cal):
    """Genera righe tabella compatibile con struttura v2.1 (params+delta) e legacy (clusters)."""
    rows = ""
    if pac_cal.get("params"):
        # Struttura v2.1
        p   = pac_cal["params"]
        ref = pac_cal.get("pace10km_ref_min_km", "?")
        dlt = pac_cal.get("delta", "?")
        rows = (f"| Power-law v2.1 | A={p['A']} α={p['alpha']} β={p['beta']} c={p['c']} | "
                f"ref={ref} min/km | delta={dlt} | "
                f"{p.get('rmse_10_60km', p.get('rmse_global','?'))}h | {p.get('n_fit','?')} |\n")
    else:
        # Struttura legacy con clusters
        for pk, pr in pac_cal.items():
            if not isinstance(pr, dict): continue
            for ctype, cr in pr.get("clusters", {}).items():
                lbl = pr.get("label", pk) + (" [Sky]" if ctype == "skyrace" else " [Trail]")
                rows += (f"| {lbl} | pace={cr.get('base_pace_min_km','?')} | "
                         f"ce={cr.get('coeff_elev','?')} | ct={cr.get('coeff_tech','?')} | "
                         f"{cr.get('rmse_hours','?')}h | {cr.get('n_races','?')} |\n")
    return rows or "_Dati non disponibili_"


def _write_report(df, today, level_counts, correlations, corr_tech_wdi,
                  anomaly_tech, anomaly_run, outliers, df_r, wdi_cal, pac_cal):
    total = len(df)
    n_gpx = int((df.get("calc_source", pd.Series()) == "gpx").sum())

    dist_rows = "\n".join(
        f"| {k} | {v} | {v/total*100:.1f}% |"
        for k, v in level_counts.items() if v > 0)

    corr_rows = "\n".join(
        f"| {k} | {v:+.3f} | {'🟢 Forte' if abs(v)>0.7 else '🟡 Moderata' if abs(v)>0.4 else '⚪ Debole'} |"
        for k, v in correlations.items())

    pac_rows = _pac_summary_rows(pac_cal)

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

    spread_top = ""
    if "ratio" in df_r.columns:
        top5 = df_r.dropna(subset=["ratio"]).sort_values("ratio", ascending=False).head(5)
        for _, r in top5.iterrows():
            spread_top += (f"- **{r['race']}** — rapporto {r['ratio']:.2f}x "
                           f"(top {r.get('avg_top100_men_hours','?'):.1f}h / "
                           f"medio {r.get('avg_finish_hours','?'):.1f}h)\n")

    anomaly_tech_str = anomaly_tech.to_string(index=False) if len(anomaly_tech) else "_Nessuna_"
    anomaly_run_str  = anomaly_run.to_string(index=False)  if len(anomaly_run)  else "_Nessuna_"
    outlier_str      = (outliers[["race", "itra_category", "wdi_computed", "wdi_z"]].to_string(index=False)
                        if len(outliers) > 0 else "_Nessun outlier significativo_")

    report = f"""# WizTrail — Report di Calibrazione
_Generato il {today} · {total} gare analizzate · {n_gpx} con GPX reale_

---

## 1. Distribuzione difficoltà WDI

| Classe | Gare | % |
|--------|------|---|
{dist_rows}

---

## 2. Calibrazione TechScore (WDI Engine)

{wdi_summary}
**Nuovi pesi normalizzati:** {wdi_weights_str}

---

## 3. Calibrazione modello tempi

| Modello | Parametri | Riferimento | Delta/RMSE | RMSE | Gare |
|---------|-----------|-------------|------------|------|------|
{pac_rows}

---

## 4. Correlazioni chiave

| Relazione | r | Intensità |
|-----------|---|-----------|
{corr_rows if corr_rows else "_Dati insufficienti_"}

---

## 5. Anomalie

### Gare molto tecniche ma WDI basso
```
{anomaly_tech_str}
```

### Gare lunghe e corribili
```
{anomaly_run_str}
```

---

## 6. Dispersione del campo

{spread_top if spread_top else "_Dati non disponibili_"}

---

## 7. Outlier per categoria ITRA

```
{outlier_str}
```

---
_Riesegui `bash run.sh` dopo ogni aggiunta di dati._
"""
    (OUTPUT_DIR / "3_insights_report.md").write_text(report)


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

    # BLOCCO A — TechScore
    lines.append("// ════════ BLOCCO A — wiztrail-engine.js › buildTechScore() ════════")
    if wdi_cal.get("tech_score_weights"):
        tw = wdi_cal["tech_score_weights"]
        nr = wdi_cal["norm_refs"]
        lines.append(f"// RMSE: {wdi_cal['rmse_before']} → {wdi_cal['rmse_after']} ({wdi_cal['improvement_pct']:+.1f}%)")
        lines.append(f"//   normFRIP  = clamp(frip      / {nr['frip']},  0, 1);")
        lines.append(f"//   normSVar  = clamp(slopeVar  / {nr['slope_var']},  0, 1);")
        lines.append(f"//   normRough = clamp(roughness / {nr['roughness']},  0, 1);")
        lines.append(f"//   vertInt   = clamp((gain/km)  / {nr['vert']},  0, 1);")
        lines.append(f"//   raw = (normFRIP*{tw['w_frip']} + normSVar*{tw['w_svar']} + normRough*{tw['w_rough']})*{tw['shape_w']}")
        lines.append(f"//         + vertInt*{tw['w_vert']};")
    else:
        lines.append(f"// ⚠️  {wdi_cal.get('note', 'GPX insufficienti per la calibrazione')}")

    lines.append("")
    lines.append("// ════════ BLOCCO B — wiztrail-pacing.js › PACING_POWERLAW ════════")

    # Struttura v2.1 (params + delta)
    if pac_cal.get("params"):
        p   = pac_cal["params"]
        ref = pac_cal.get("pace10km_ref_min_km", 4.74)
        dlt = pac_cal.get("delta", 0.994)
        lines.append(f"// RMSE 10-60km: {p.get('rmse_10_60km', p.get('rmse_global','?'))}h  n={p.get('n_fit','?')}")
        lines.append("const PACING_POWERLAW = {")
        lines.append(f"  pace10km_ref: {ref},")
        lines.append(f"  delta:        {dlt},")
        lines.append(f"  A:     {p['A']},")
        lines.append(f"  alpha: {p['alpha']},")
        lines.append(f"  beta:  {p['beta']},")
        lines.append(f"  c:     {p['c']},")
        lines.append("};")
        lines.append("")
        lines.append("// Helper:")
        lines.append("// function estimatePersonalTime(km, dplus, tech, pace10km) {")
        lines.append("//   const p = PACING_POWERLAW;")
        lines.append("//   const dkm = dplus / Math.max(km, 1);")
        lines.append("//   const T_ref = p.A * Math.pow(km,p.alpha) * Math.pow(Math.max(dkm,0.5),p.beta) * (1+p.c*tech/10);")
        lines.append("//   return T_ref * Math.pow(pace10km / p.pace10km_ref, p.delta);")
        lines.append("// }")
    else:
        # Legacy clusters
        for pk, pr in pac_cal.items():
            if not isinstance(pr, dict): continue
            for ctype, cr in pr.get("clusters", {}).items():
                const_name = f"PACING_{pk.upper()}_{ctype.upper()}"
                lines.append(f"const {const_name} = {{")
                lines.append(f"  basePaceMinKm: {cr.get('base_pace_min_km','?')},")
                lines.append(f"  coeffElev:     {cr.get('coeff_elev','?')},")
                lines.append(f"  coeffTech:     {cr.get('coeff_tech','?')},")
                lines.append(f"  expoDistCorr:  {cr.get('expo_dist','?')},")
                lines.append("};")
                lines.append("")

    (OUTPUT_DIR / "4_wiztrail_patch.js").write_text("\n".join(lines))


def save_history(wdi_cal, pac_cal, df):
    history_dir = Path("history")
    history_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

    hist_plots = history_dir / "plots"
    hist_plots.mkdir(exist_ok=True)
    for png in PLOTS_DIR.glob("*.png"):
        if png.name == "history_rmse.png":
            continue
        dest = hist_plots / f"{ts}_{png.name}"
        dest.write_bytes(png.read_bytes())

    n_gpx   = int((df.get("calc_source", pd.Series()) == "gpx").sum()) if "calc_source" in df.columns else 0
    n_total = len(df)

    # RMSE pacing — compatibile con v2.1 e legacy
    pacing_rmse = {}
    if pac_cal.get("params"):
        p = pac_cal["params"]
        pacing_rmse["global"] = p.get("rmse_global")
        pacing_rmse["10_60km"] = p.get("rmse_10_60km")
    else:
        for pk, pr in pac_cal.items():
            if not isinstance(pr, dict): continue
            rmse_vals = [cr["rmse_hours"] for cr in pr.get("clusters", {}).values() if "rmse_hours" in cr]
            pacing_rmse[pk] = round(sum(rmse_vals) / len(rmse_vals), 3) if rmse_vals else None

    snapshot = {
        "timestamp":          ts,
        "n_races_total":      n_total,
        "n_races_gpx":        n_gpx,
        "wdi_rmse_before":    wdi_cal.get("rmse_before"),
        "wdi_rmse_after":     wdi_cal.get("rmse_after"),
        "wdi_improvement_pct": wdi_cal.get("improvement_pct"),
        "wdi_weights":        wdi_cal.get("tech_score_weights"),
        "pacing_rmse":        pacing_rmse,
    }

    out_path = history_dir / f"{ts}_run.json"
    out_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
    print(f"  ✓  Storia salvata → history/{out_path.name}")
    return snapshot


def plot_history():
    history_dir = Path("history")
    if not history_dir.exists(): return

    runs = sorted(history_dir.glob("*_run.json"))
    if len(runs) < 2: return

    records = []
    for r in runs:
        try: records.append(json.loads(r.read_text()))
        except: continue
    if not records: return

    dates    = [r["timestamp"][:10] for r in records]
    rmse_wdi = [r.get("wdi_rmse_after") for r in records]
    rmse_pace = [r.get("pacing_rmse", {}).get("10_60km") or
                 r.get("pacing_rmse", {}).get("avg_finish") for r in records]

    fig, axes = plt.subplots(1, 2, figsize=(13, 4))
    fig.patch.set_facecolor("#fafafa")
    fig.suptitle("Evoluzione modello WizTrail nel tempo", fontsize=13, fontweight="bold")
    x = range(len(dates))

    for ax, vals, color, title, ylabel in [
        (axes[0], rmse_wdi,  "#E8593C", "Calibrazione WDI (RMSE ↓ = meglio)",    "RMSE TechScore"),
        (axes[1], rmse_pace, "#3B8BD4", "Calibrazione tempi 10-60km (RMSE ↓ = meglio)", "RMSE (ore)"),
    ]:
        valid = [(i, v) for i, v in enumerate(vals) if v is not None]
        if valid:
            xi, yi = zip(*valid)
            ax.plot(xi, yi, "o-", color=color, lw=2, ms=7)
            for i, v in valid:
                ax.annotate(f"{v:.2f}", (i, v), textcoords="offset points",
                            xytext=(0, 8), fontsize=8, ha="center", color=color)
        ax.set_xticks(list(x)); ax.set_xticklabels(dates, rotation=30, ha="right", fontsize=8)
        ax.set_ylabel(ylabel); ax.set_title(title)
        ax.set_facecolor("#f5f5f5"); ax.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "history_rmse.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  ✓  Grafico storico → output/plots/history_rmse.png  ({len(records)} run)")


if __name__ == "__main__":
    main()
