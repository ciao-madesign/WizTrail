"""
Script 02c — Calibrazione KF_TERRAIN_PARAMS (tech_scale, specificity_weight)

Usa i risultati di 02b_timing_vs_reality.py (est_h post fatigue-cap) per trovare
i valori ottimali di KF_TERRAIN_PARAMS che minimizzano l'errore residuo.

Formula KF_TERRAIN (da wiztrail-timing.js Fase 12):
  KF = 1 + (TechScore / tech_scale) × (1 - S × specificity_weight)
  T_corrected = T_segment × KF

Proxy TechScore = technicality × 10 (da dataset.xlsx, scala 0-10 → 0-100).
Calibrazione su profilo avg_finish (S=0.40) — più confrontabile con Kaggle mediana.

Output:
  - Stampa valori ottimali da copiare in wiztrail-timing.js e api/lib/timing-node.js
  - data/kf_terrain_calibration.json
"""

import csv, json, math, statistics
from pathlib import Path

DATA_DIR = Path("data")
INPUT    = DATA_DIR / "timing_vs_reality.csv"
OUTPUT   = DATA_DIR / "kf_terrain_calibration.json"

S_AVG_FINISH = 0.40

# ── Carica dati (avg_finish con technicality disponibile)
rows = []
with open(INPUT, encoding="utf-8") as f:
    for r in csv.DictReader(f):
        if r["profile"] != "avg_finish": continue
        tech = r.get("technicality") or ""
        try:
            t = float(tech)
        except ValueError:
            continue
        try:
            est_h  = float(r["est_h"])
            real_h = float(r["real_h"])
        except (ValueError, KeyError):
            continue
        if est_h <= 0 or real_h <= 0: continue
        rows.append({
            "race":    r["race"],
            "tech":    t,
            "ts":      t * 10.0,   # proxy TechScore 0–100
            "est_h":   est_h,
            "real_h":  real_h,
            "delta0":  (est_h - real_h) / real_h * 100,
        })

print(f"Osservazioni per calibrazione: {len(rows)}")

def rmse_weighted(deltas, weights=None):
    if weights is None: weights = [1.0] * len(deltas)
    sw = sum(weights)
    return math.sqrt(sum(w * d**2 for d,w in zip(deltas, weights)) / sw)

def apply_kf(rows, tech_scale, sw):
    errors = []
    for r in rows:
        kf = 1 + (r["ts"] / tech_scale) * (1 - S_AVG_FINISH * sw)
        t_corr = r["est_h"] * kf
        errors.append((t_corr - r["real_h"]) / r["real_h"] * 100)
    return errors

# ── Griglia ricerca: tech_scale ∈ [50, 350], specificity_weight ∈ [0.2, 0.8]
print("\n⏳  Grid search (tech_scale × specificity_weight)…")
best_rmse = 1e9
best_ts, best_sw = 400, 0.4   # valori attuali di default

results = []
for ts in range(50, 351, 5):
    for sw_i in range(20, 81, 5):
        sw = sw_i / 100.0
        errors = apply_kf(rows, ts, sw)
        r = rmse_weighted(errors)
        b = statistics.mean(errors)
        results.append((r, abs(b), ts, sw))
        if r < best_rmse:
            best_rmse = r
            best_ts, best_sw = ts, sw

print(f"\n  Valori attuali    tech_scale=400  sw=0.40  RMSE={rmse_weighted(apply_kf(rows,400,0.4)):.1f}%  bias={statistics.mean(apply_kf(rows,400,0.4)):+.1f}%")
print(f"  Valori ottimali   tech_scale={best_ts:<4d}  sw={best_sw:.2f}   RMSE={best_rmse:.1f}%  bias={statistics.mean(apply_kf(rows,best_ts,best_sw)):+.1f}%")

# Top 10 combinazioni (RMSE più basso, poi bias più basso)
results.sort()
print("\n  Top 10 combinazioni (RMSE minore):")
print(f"  {'ts':>5}  {'sw':>5}  {'RMSE':>7}  {'bias':>7}")
for rmse_v, bias_abs, ts, sw in results[:10]:
    bias_v = statistics.mean(apply_kf(rows, ts, sw))
    print(f"  {ts:>5}  {sw:>5.2f}  {rmse_v:>7.1f}%  {bias_v:>+7.1f}%")

# ── Analisi impatto per tecnicità
print("\n── Impatto per livello tecnicità (tech_scale ottimale) ──────────────────")
print(f"  {'Tier':22s}  {'n':>4}  {'RMSE prima':>10}  {'RMSE dopo':>9}  {'bias prima':>10}  {'bias dopo':>9}")
tiers = [
    ("low (0-3)",     lambda r: r["tech"] < 3),
    ("medium (3-6)",  lambda r: 3 <= r["tech"] < 6),
    ("high (6-8)",    lambda r: 6 <= r["tech"] < 8),
    ("extreme (8-10)",lambda r: r["tech"] >= 8),
]
for label, fn in tiers:
    sub = [r for r in rows if fn(r)]
    if not sub: continue
    d_before = [r["delta0"] for r in sub]
    d_after  = apply_kf(sub, best_ts, best_sw)
    print(f"  {label:22s}  {len(sub):>4}  "
          f"{rmse_weighted(d_before):>10.1f}%  {rmse_weighted(d_after):>9.1f}%  "
          f"{statistics.mean(d_before):>+10.1f}%  {statistics.mean(d_after):>+9.1f}%")

# ── Per-gara confronto (ordinato per delta residuo)
print("\n── Dettaglio per gara ─────────────────────────────────────────────────────")
print(f"  {'Gara':40s}  {'tech':>4}  {'Δ prima':>8}  {'KF':>5}  {'Δ dopo':>8}")
for r in sorted(rows, key=lambda x: abs(apply_kf([x], best_ts, best_sw)[0]), reverse=True):
    kf = 1 + (r["ts"] / best_ts) * (1 - S_AVG_FINISH * best_sw)
    d_after = apply_kf([r], best_ts, best_sw)[0]
    print(f"  {r['race'][:39]:40s}  {r['tech']:>4.1f}  {r['delta0']:>+8.1f}%  {kf:>5.2f}  {d_after:>+8.1f}%")

# ── Salva
out = {
    "current": {"tech_scale": 400, "specificity_weight": 0.4,
                "rmse": round(rmse_weighted(apply_kf(rows, 400, 0.4)), 2),
                "bias": round(statistics.mean(apply_kf(rows, 400, 0.4)), 2)},
    "optimal": {"tech_scale": best_ts, "specificity_weight": best_sw,
                "rmse": round(best_rmse, 2),
                "bias": round(statistics.mean(apply_kf(rows, best_ts, best_sw)), 2)},
    "n_races":   len(rows),
    "note": "TechScore proxy = technicality×10 da dataset.xlsx. Rifare con TechScore reale da GPX dopo 02_compute_wdi.py."
}
with open(OUTPUT, "w") as f:
    json.dump(out, f, indent=2)

print(f"\n📄  {OUTPUT}")
print(f"\n=== COSTANTI DA COPIARE IN wiztrail-timing.js e api/lib/timing-node.js ===")
print(f"  const KF_TERRAIN_PARAMS = {{")
print(f"    tech_scale:         {best_ts},")
print(f"    specificity_weight: {best_sw},")
print(f"  }};")
