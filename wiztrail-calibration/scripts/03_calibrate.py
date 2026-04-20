"""
Script 03 — Calibrazione WDI + Modello Tempi v2.1
───────────────────────────────────────────────────
Parte A: pesi buildTechScore() ottimizzati su GPX reali (invariato)

Parte B: modello power-law personalizzato per passo 10km atleta
  Formula: T = A × km^alpha × (D+/km)^beta × (1 + c × tech/10)
                × (pace10km_utente / pace10km_ref)^delta

  Calibrato con peso 3× sulla fascia 10-60km (utente target WizTrail).
  Riferimento: top 100 uomini (RMSE 0.69h su 10-60km).
  Delta: scaling atleta calibrato da ratio top100/medio su 83 gare.
  pace10km_ref = 4.740 min/km (~47 min su 10km road flat).
"""
import json, math, warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.optimize import differential_evolution, minimize_scalar
from pathlib import Path

warnings.filterwarnings("ignore")
DATA_DIR   = Path("data")
OUTPUT_DIR = Path("output")
PLOTS_DIR  = OUTPUT_DIR / "plots"
OUTPUT_DIR.mkdir(exist_ok=True)
PLOTS_DIR.mkdir(exist_ok=True)

kT    = 0.35
REF42 = math.pow(42, 0.55)


def clamp(x, a, b):
    return max(a, min(b, x))


def enrich_df(df):
    df = df.copy()
    df["km_eff"]       = df["gpx_km"].fillna(df["distance_km"])
    df["gain_eff"]     = df["gpx_gain"].fillna(df["elevation_m"])
    df["loss_eff"]     = df["gpx_loss"].fillna(df["elevation_m"])
    df["dplus_per_km"] = df["gain_eff"] / df["km_eff"].clip(lower=1)
    df["race_type"]    = df["dplus_per_km"].apply(
        lambda x: "skyrace" if x > 60 else "trail_ultra")
    return df


# ══════════════════════════════════════════════════════
#  PARTE A — TechScore (invariata)
# ══════════════════════════════════════════════════════

def build_ts_param(frip, sv, rough, gain, km,
                   nf_r, ns_r, nr_r, nv_r, wf, ws, wr, wv, shp):
    nf  = clamp(frip / nf_r,                  0, 1)
    ns  = clamp(sv   / ns_r,                  0, 1)
    nr  = clamp(rough / nr_r,                 0, 1)
    nv  = clamp((gain / max(km, 0.1)) / nv_r, 0, 1)
    raw = (wf * nf + ws * ns + wr * nr) * shp + wv * nv * (1 - shp)
    return raw * 100


def tech_obj(params, df, target, wcol):
    nf_r, ns_r, nr_r, nv_r, wf, ws, wr, wv, shp = params
    if any(p <= 0 for p in [nf_r, ns_r, nr_r, nv_r, wf, ws, wr, wv]):
        return 1e9
    wt = wf + ws + wr + wv
    wf /= wt; ws /= wt; wr /= wt; wv /= wt
    shp = clamp(shp, 0.3, 0.9)
    preds = df.apply(lambda r: build_ts_param(
        r["gpx_frip"], r["gpx_slope_var"], r["gpx_roughness"],
        r["gpx_gain"], r["gpx_km"],
        nf_r, ns_r, nr_r, nv_r, wf, ws, wr, wv, shp), axis=1).values
    return float(np.sqrt(np.average(
        (preds - target) ** 2, weights=df[wcol].values)))


# ══════════════════════════════════════════════════════
#  PARTE B — Modello power-law personalizzato v2.1
# ══════════════════════════════════════════════════════

def predict_powerlaw(A, alpha, beta, c, km, dplus_km, tech):
    """
    T [ore] = A × km^alpha × (D+/km)^beta × (1 + c × tech/10)
    Usa D+/km (pendenza media), più stabile di D+ assoluto.
    """
    return (A
            * math.pow(max(km, 1),        alpha)
            * math.pow(max(dplus_km, 0.5), beta)
            * (1 + c * tech / 10.))


def powerlaw_obj_weighted(params, df_sub, col, weight_col):
    A, alpha, beta, c = params
    if A <= 0 or alpha <= 0 or beta < 0 or c < 0:
        return 1e9
    d = df_sub.dropna(subset=[col])
    if len(d) < 5:
        return 1e9
    preds = d.apply(lambda r: predict_powerlaw(
        A, alpha, beta, c,
        r["km_eff"], r["dplus_per_km"], r["technicality"]), axis=1)
    resid = (preds.values - d[col].values) ** 2
    return float(np.sqrt(np.average(resid, weights=d[weight_col].values)))


def calibrate_powerlaw(df):
    """Calibra power-law su top100 uomini, peso 3x su 10-60km."""
    df = df.copy()
    df["w_pl"] = df["km_eff"].apply(lambda x: 3.0 if 10 <= x <= 60 else 1.0)

    col   = "avg_top100_men_hours"
    d_fit = df.dropna(subset=[col, "km_eff", "dplus_per_km", "technicality"]).copy()
    bounds = [(0.001, 5.0), (0.50, 1.50), (0.00, 1.50), (0.0, 3.0)]

    res = differential_evolution(
        powerlaw_obj_weighted, bounds,
        args=(d_fit, col, "w_pl"),
        seed=42, maxiter=800, tol=1e-11, workers=1, polish=True)
    xp = res.x

    # RMSE non pesato globale e fascia target
    def rmse_plain(d_sub):
        p = d_sub.dropna(subset=[col]).apply(
            lambda r: predict_powerlaw(xp[0], xp[1], xp[2], xp[3],
                                       r["km_eff"], r["dplus_per_km"], r["technicality"]),
            axis=1)
        t = d_sub.dropna(subset=[col])[col].values
        return float(np.sqrt(np.mean((p.values - t) ** 2)))

    rmse_all = rmse_plain(d_fit)
    d_tgt    = d_fit[(d_fit["km_eff"] >= 10) & (d_fit["km_eff"] <= 60)]
    rmse_tgt = rmse_plain(d_tgt) if len(d_tgt) >= 3 else float("nan")

    return {
        "A":     round(float(xp[0]), 5),
        "alpha": round(float(xp[1]), 4),
        "beta":  round(float(xp[2]), 4),
        "c":     round(float(xp[3]), 4),
        "rmse_global":     round(rmse_all, 3),
        "rmse_10_60km":    round(rmse_tgt, 3),
        "n_fit":           int(len(d_fit)),
    }


def calibrate_delta(df, params):
    """Calibra delta (esponente scaling atleta) e pace_10km_ref."""
    d_ref = df[
        (df["km_eff"] >= 10) & (df["km_eff"] <= 60) &
        (df["race_type"] == "trail_ultra")
    ].dropna(subset=["avg_top100_men_hours"])
    pace_trail_top = (d_ref["avg_top100_men_hours"] * 60 / d_ref["km_eff"]).median()
    pace_10km_ref  = pace_trail_top * 0.72

    d_both = df.dropna(subset=[
        "avg_finish_hours", "avg_top100_men_hours",
        "km_eff", "dplus_per_km", "technicality"]).copy()

    def delta_obj(delta):
        errs = []
        for _, r in d_both.iterrows():
            T_top       = predict_powerlaw(
                params["A"], params["alpha"], params["beta"], params["c"],
                r["km_eff"], r["dplus_per_km"], r["technicality"])
            pace_10km_u = (r["avg_finish_hours"] * 60 / r["km_eff"]) * 0.72
            f           = math.pow(pace_10km_u / pace_10km_ref, delta)
            errs.append((T_top * f - r["avg_finish_hours"]) ** 2)
        return math.sqrt(sum(errs) / len(errs))

    res   = minimize_scalar(delta_obj, bounds=(0.3, 2.0), method="bounded")
    delta = round(float(res.x), 4)
    rmse  = round(float(res.fun), 3)
    return round(pace_10km_ref, 4), delta, rmse


def sanity_check(df, params, pace_10km_ref, delta):
    benchmarks = [
        "Sierre-Zinal", "Eiger 35K", "Zegama-Aizkorri",
        "Dolomiti Extreme 55K", "CCC", "UTMB",
        "Western States 100", "Hardrock 100", "Tarawera 100K",
    ]
    results = []
    for race in benchmarks:
        row = df[df["race"] == race]
        if row.empty:
            continue
        r    = row.iloc[0]
        km   = r["gpx_km"]   if pd.notna(r.get("gpx_km"))   else r.get("distance_km")
        gain = r["gpx_gain"] if pd.notna(r.get("gpx_gain")) else r.get("elevation_m")
        if pd.isna(km) or pd.isna(gain):
            continue
        dkm  = gain / max(km, 1)
        T_ref = predict_powerlaw(
            params["A"], params["alpha"], params["beta"], params["c"],
            km, dkm, r["technicality"])
        entry = {"race": race, "km": km, "gain": gain}
        for t10 in [44, 50, 60, 70]:
            f = math.pow((t10 / 10.) / pace_10km_ref, delta)
            entry[f"stima_{t10}min"] = round(T_ref * f, 2)
        for col, lbl in [("avg_top100_men_hours", "reale_top100"),
                         ("avg_finish_hours",      "reale_medio")]:
            entry[lbl] = round(r[col], 1) if pd.notna(r.get(col)) else None
        results.append(entry)
    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    df = pd.read_csv(DATA_DIR / "computed.csv")
    df = enrich_df(df)
    print(f"  Gare totali: {len(df)}")

    # ── A ────────────────────────────────────────────────────────────────────
    df_gpx = df[df["calc_source"] == "gpx"].dropna(
        subset=["gpx_frip", "gpx_slope_var", "gpx_roughness",
                "gpx_gain", "gpx_km", "technicality"])
    n = len(df_gpx)
    print(f"\n  [A] TechScore — {n} GPX")
    wdi_calib = {}
    xo = [0.60, 0.55, 0.35, 150., 0.45, 0.35, 0.20, 0.30, 0.70]

    if n >= 5:
        target = df_gpx["technicality"].values * 10.
        bounds = [(0.20, 1.50), (0.10, 1.50), (0.05, 1.50), (50, 300),
                  (0.05, 0.80), (0.05, 0.80), (0.05, 0.60), (0.05, 0.60),
                  (0.30, 0.90)]
        rb  = tech_obj(xo, df_gpx, target, "feedback_affidability")
        res = differential_evolution(
            tech_obj, bounds,
            args=(df_gpx, target, "feedback_affidability"),
            seed=42, maxiter=500, tol=1e-9, workers=1, polish=True)
        xo = res.x; ra = res.fun
        wt = xo[4] + xo[5] + xo[6] + xo[7]
        wdi_calib = {
            "tech_score_weights": {
                "w_frip":  round(xo[4] / wt, 3), "w_svar": round(xo[5] / wt, 3),
                "w_rough": round(xo[6] / wt, 3), "w_vert": round(xo[7] / wt, 3),
                "shape_w": round(clamp(xo[8], 0.3, 0.9), 3)},
            "norm_refs": {
                "frip":      round(xo[0], 3), "slope_var": round(xo[1], 3),
                "roughness": round(xo[2], 3), "vert":      round(xo[3], 1)},
            "rmse_before":     round(rb, 3), "rmse_after": round(ra, 3),
            "improvement_pct": round((rb - ra) / rb * 100, 1),
            "n_races_gpx":     n}
        print(f"     RMSE: {rb:.2f}→{ra:.2f}  ({wdi_calib['improvement_pct']:+.1f}%)")
        print(f"     Pesi: FRIP={xo[4]/wt:.3f}  SVar={xo[5]/wt:.3f}  "
              f"Rough={xo[6]/wt:.3f}  Vert={xo[7]/wt:.3f}")
    else:
        print(f"     ⚠️  Solo {n} GPX — serve ≥5")
        wdi_calib = {"note": f"Servono ≥5 GPX, {n} disponibili", "n_races_gpx": n}

    # ── B ────────────────────────────────────────────────────────────────────
    print(f"\n  [B] Modello tempi power-law v2.1")

    params = calibrate_powerlaw(df)
    print(f"     A={params['A']}  alpha={params['alpha']}  "
          f"beta={params['beta']}  c={params['c']}")
    print(f"     RMSE globale={params['rmse_global']:.3f}h  "
          f"RMSE 10-60km={params['rmse_10_60km']:.3f}h  n={params['n_fit']}")

    pace_10km_ref, delta, rmse_delta = calibrate_delta(df, params)
    print(f"     pace_10km_ref={pace_10km_ref:.4f} min/km "
          f"({pace_10km_ref*10:.1f}min/10km)  delta={delta}  "
          f"RMSE_delta={rmse_delta:.3f}h")

    checks = sanity_check(df, params, pace_10km_ref, delta)
    print(f"\n     Sanity check (44 / 60 / 70 min su 10km):")
    for r in checks:
        s44 = r.get("stima_44min", "?"); s60 = r.get("stima_60min", "?")
        s70 = r.get("stima_70min", "?")
        top = r.get("reale_top100", "?"); med = r.get("reale_medio", "?")
        print(f"       {r['race']:<28}: "
              f"44min→{s44}h  60min→{s60}h  70min→{s70}h  "
              f"[top={top}  medio={med}]")

    pacing_output = {
        "_description": "Power-law pacing model v2.1 — personalizzato per passo 10km",
        "_formula":     "T_ore = A * km^alpha * (D+/km)^beta * (1+c*tech/10) * (pace10km/ref)^delta",
        "_version":     "2.1",
        "pace10km_ref_min_km": pace_10km_ref,
        "pace10km_ref_note":   "~47 min su 10km road flat. Riferimento: top 100 uomini.",
        "delta":             delta,
        "delta_rmse_hours":  rmse_delta,
        "skyrace_threshold_dplus_per_km": 60,
        "params":            params,
        "validation":        {r["race"]: r for r in checks},
        "user_guide": {
            "input":   "pace10km in min/km (es. 52min su 10km → 5.2)",
            "formula": "f = (pace10km / pace10km_ref)^delta;  T = T_ref * f",
            "profili": {
                "44min/10km (4.4 min/km)": "Agonista forte",
                "50min/10km (5.0 min/km)": "Amatore avanzato",
                "60min/10km (6.0 min/km)": "Amatore medio  ← fascia target",
                "70min/10km (7.0 min/km)": "Runner base    ← fascia target",
            }
        }
    }

    _plot_wdi(df_gpx, xo, wdi_calib)
    _plot_pacing(df, params, pace_10km_ref, delta)

    (OUTPUT_DIR / "1_wdi_calibration.json").write_text(
        json.dumps(wdi_calib, indent=2, ensure_ascii=False))
    (OUTPUT_DIR / "2_pacing_coefficients.json").write_text(
        json.dumps(pacing_output, indent=2, ensure_ascii=False))
    print(f"\n  ✓  Output salvati in output/")


# ── Grafici ───────────────────────────────────────────────────────────────────

def _plot_wdi(df_gpx, xo, cal):
    if df_gpx.empty:
        return
    wt = max(xo[4] + xo[5] + xo[6] + xo[7], 1e-9)

    def ts_opt(r):
        shp = clamp(xo[8], 0.3, 0.9)
        nf  = clamp(r["gpx_frip"]      / xo[0], 0, 1)
        ns  = clamp(r["gpx_slope_var"] / xo[1], 0, 1)
        nr  = clamp(r["gpx_roughness"] / xo[2], 0, 1)
        nv  = clamp((r["gpx_gain"] / max(r["gpx_km"], 0.1)) / xo[3], 0, 1)
        return (((xo[4]/wt)*nf + (xo[5]/wt)*ns + (xo[6]/wt)*nr) * shp
                + (xo[7]/wt) * nv * (1 - shp)) * 100

    target = df_gpx["technicality"] * 10
    opt    = df_gpx.apply(ts_opt, axis=1)
    curr   = df_gpx["tech_computed"]

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    fig.patch.set_facecolor("#fafafa")
    for ax, vals, clr, ttl in zip(
            axes, [curr, opt], ["#E8593C", "#1D9E75"],
            ["TechScore attuale", "TechScore ottimizzato"]):
        ax.scatter(target, vals, c=clr, alpha=0.7, s=55,
                   edgecolors="white", linewidths=0.4)
        ax.plot([0, 100], [0, 100], "k--", alpha=0.25, lw=1)
        if len(target) > 1:
            rr = np.corrcoef(target, vals)[0, 1]
            ax.text(5, 92, f"r = {rr:.3f}", fontsize=11, color=clr, fontweight="bold")
        ax.set_xlabel("Technicality × 10"); ax.set_ylabel("TechScore WizTrail")
        ax.set_title(ttl); ax.set_xlim([0, 100]); ax.set_ylim([0, 100])
        ax.set_facecolor("#f5f5f5"); ax.grid(alpha=0.3)
    fig.suptitle(f"Calibrazione TechScore — {len(df_gpx)} GPX reali",
                 fontsize=13, fontweight="bold")
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "wdi_scatter.png", dpi=150, bbox_inches="tight")
    plt.close()


def _plot_pacing(df, params, pace_10km_ref, delta):
    ATLETI = [
        (44, "#E8593C", "Agonista forte (44min/10km)"),
        (60, "#3B8BD4", "Amatore medio  (60min/10km)"),
        (70, "#1D9E75", "Runner base    (70min/10km)"),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    fig.patch.set_facecolor("#fafafa")
    fig.suptitle("Modello tempi v2.1 — stima personalizzata",
                 fontsize=13, fontweight="bold")

    d = df.dropna(subset=["avg_finish_hours", "km_eff",
                           "dplus_per_km", "technicality"]).copy()

    for ax, (t10, color, label) in zip(axes, ATLETI):
        f     = math.pow((t10 / 10.) / pace_10km_ref, delta)
        preds = d.apply(lambda r: predict_powerlaw(
            params["A"], params["alpha"], params["beta"], params["c"],
            r["km_eff"], r["dplus_per_km"], r["technicality"]) * f, axis=1)
        real = d["avg_finish_hours"]
        ax.scatter(real, preds, c=color, alpha=0.7, s=55,
                   edgecolors="white", linewidths=0.4)
        mx = max(real.max(), preds.max()) * 1.08
        ax.plot([0, mx], [0, mx], "k--", alpha=0.25, lw=1)
        if len(real) > 1:
            rr   = np.corrcoef(real, preds)[0, 1]
            rmse = math.sqrt(np.mean((preds.values - real.values) ** 2))
            ax.text(0.5, mx * 0.92, f"r={rr:.3f}  RMSE={rmse:.1f}h",
                    fontsize=9, color=color, fontweight="bold")
        ax.set_xlabel("Tempo reale medio (ore)")
        ax.set_ylabel("Tempo stimato (ore)")
        ax.set_title(label)
        ax.set_facecolor("#f5f5f5"); ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / "pacing_scatter.png", dpi=150, bbox_inches="tight")
    plt.close()


if __name__ == "__main__":
    main()
