"""
Script 00b — Fit modello mediana e sigma percentili da dataset UTMB

Input:  data/kaggle_utmb_processed.csv  (output di 00_kaggle_import.py)

Modello mediana (power law con fattore altitudine):
  T_median_h = a * km^b * (dplus/1000)^c * exp(d * alt_km)

  dove alt_km = alt_m / 1000  (quota media in km)

Modello sigma (per percentile atleta):
  sigma_log per categoria distanza → distribuzione log-normale
  P(T_utente < T) = Phi((ln(T_utente) - ln(T_median)) / sigma)

Output:
  - Stampa costanti MEDIAN_MODEL e PERCENTILE_SIGMA da incollare
    in wiztrail-timing.js e api/lib/timing-node.js
  - Salva plots diagnostici in data/plots/ (se matplotlib disponibile)
  - Salva data/kaggle_median_model.json con i coefficienti
"""

import csv
import json
import math
import statistics
from pathlib import Path

INPUT_CSV   = Path("data/kaggle_utmb_processed.csv")
OUTPUT_JSON = Path("data/kaggle_median_model.json")
PLOTS_DIR   = Path("data/plots")

# ── Carica dati processati
print("⏳  Caricamento dati processati…")
records = []
with open(INPUT_CSV, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        try:
            records.append({
                "km":    float(row["km"]),
                "dplus": float(row["dplus"]),
                "alt_m": float(row["alt_m"]) if row["alt_m"] else 0.0,
                "t_med": float(row["true_median_h"]),
                "sigma": float(row["sigma_log"]),
                "n":     int(row["n_finishers"]),
            })
        except (ValueError, KeyError):
            pass

print(f"  Gare caricate: {len(records)}")

# ── Categorie distanza (stesse di WizTrail)
def dist_cat(km):
    if km <= 25:  return "short"
    if km <= 50:  return "medium"
    if km <= 95:  return "long"
    return "ultra"

# ── Ordinary Least Squares su scala logaritmica
# ln(T) = ln(a) + b*ln(km) + c*ln(dplus/1000) + d*alt_km
# Risolto con regressione lineare su variabili trasformate

def fit_ols(data):
    """Regressione lineare multipla: Y = X @ beta  (no numpy — stdlib only)"""
    # data: lista di (y, x1, x2, x3)  — già in scala log
    n = len(data)
    k = len(data[0]) - 1  # numero predittori (incluso intercept)

    # Costruisce X (con colonna 1 per intercept) e Y
    Y = [d[0] for d in data]
    X = [[1.0] + list(d[1:]) for d in data]

    # X^T X
    XT = [[X[r][c] for r in range(n)] for c in range(k+1)]
    XTX = [[sum(XT[i][r]*X[r][j] for r in range(n)) for j in range(k+1)] for i in range(k+1)]
    XTY = [sum(XT[i][r]*Y[r] for r in range(n)) for i in range(k+1)]

    # Inversione manuale con eliminazione di Gauss (piccola matrice 4×4)
    aug = [XTX[i] + [XTY[i]] for i in range(k+1)]
    m = k+1
    for col in range(m):
        pivot = max(range(col, m), key=lambda r: abs(aug[r][col]))
        aug[col], aug[pivot] = aug[pivot], aug[col]
        pv = aug[col][col]
        if abs(pv) < 1e-12:
            return None
        aug[col] = [v/pv for v in aug[col]]
        for row in range(m):
            if row != col:
                f = aug[row][col]
                aug[row] = [aug[row][j] - f*aug[col][j] for j in range(m+1)]
    beta = [aug[i][m] for i in range(m)]
    return beta  # [ln_a, b, c, d]

# ── Fit globale
def prepare_row(r):
    if r["dplus"] <= 0 or r["km"] <= 0 or r["t_med"] <= 0:
        return None
    alt_km = r["alt_m"] / 1000.0
    return (
        math.log(r["t_med"]),
        math.log(r["km"]),
        math.log(r["dplus"] / 1000.0),
        alt_km,
    )

data_all = [row for r in records if (row := prepare_row(r)) is not None]
print(f"  Punti per regressione globale: {len(data_all)}")

beta = fit_ols(data_all)
if beta is None:
    print("❌  Regressione fallita — matrice singolare")
    exit(1)

ln_a, b_km, b_dp, b_alt = beta
a = math.exp(ln_a)
print(f"\n=== Modello globale ===")
print(f"  T_median = {a:.6f} * km^{b_km:.4f} * (D+/1000)^{b_dp:.4f} * exp({b_alt:.4f} * alt_km)")

# ── Fit per categoria
cat_models = {}
cat_sigmas = {}

for cat in ("short", "medium", "long", "ultra"):
    cat_records = [r for r in records if dist_cat(r["km"]) == cat]
    cat_data    = [row for r in cat_records if (row := prepare_row(r)) is not None]

    if len(cat_data) < 20:
        print(f"  ⚠  {cat}: troppo pochi dati ({len(cat_data)}), uso modello globale")
        cat_models[cat] = {"a": a, "b": b_km, "c": b_dp, "d": b_alt}
    else:
        cb = fit_ols(cat_data)
        if cb is None:
            cat_models[cat] = {"a": a, "b": b_km, "c": b_dp, "d": b_alt}
        else:
            ca, cb_km, cb_dp, cb_alt = math.exp(cb[0]), cb[1], cb[2], cb[3]
            cat_models[cat] = {"a": ca, "b": cb_km, "c": cb_dp, "d": cb_alt}
            # R² sul training set
            preds = [math.exp(cb[0] + cb[1]*d[1] + cb[2]*d[2] + cb[3]*d[3]) for d in cat_data]
            actuals = [math.exp(d[0]) for d in cat_data]
            ss_res = sum((p-a_)**2 for p,a_ in zip(preds,actuals))
            ss_tot = sum((a_-statistics.mean(actuals))**2 for a_ in actuals)
            r2 = 1 - ss_res/ss_tot if ss_tot > 0 else 0

    # Sigma log-normale (mediana delle sigma individuali, pesata per n finisher)
    sigmas_w = [(r["sigma"], r["n"]) for r in cat_records if r["sigma"] > 0]
    if sigmas_w:
        total_w = sum(w for _, w in sigmas_w)
        sigma_weighted = sum(s*w for s,w in sigmas_w) / total_w
        cat_sigmas[cat] = round(sigma_weighted, 3)
    else:
        cat_sigmas[cat] = 0.30

    m = cat_models[cat]
    n_cat = len(cat_data)
    r2_str = f"  R²={r2:.3f}" if n_cat >= 20 and 'r2' in dir() else ""
    print(f"  {cat:8s} ({n_cat:5d} gare): a={m['a']:.5f}  b={m['b']:.4f}  "
          f"c={m['c']:.4f}  d={m['d']:.4f}  σ={cat_sigmas[cat]:.3f}{r2_str}")

# ── Salva JSON modello
model_json = {
    "source": "UTMB World Race Data, Maarten Poirot (Kaggle)",
    "n_races": len(records),
    "formula": "T_median_h = a * km^b * (dplus_k)^c * exp(d * alt_km)",
    "categories": cat_models,
    "sigma": cat_sigmas,
}
PLOTS_DIR.mkdir(parents=True, exist_ok=True)
with open(OUTPUT_JSON, "w") as f:
    json.dump(model_json, f, indent=2)
print(f"\n📄  Modello salvato: {OUTPUT_JSON}")

# ── Output costanti JS
print("\n" + "="*60)
print("COPIA IN wiztrail-timing.js → MEDIAN_MODEL:")
print("="*60)
print("  const MEDIAN_MODEL = {")
for cat, m in cat_models.items():
    print(f"    {cat}: {{ a: {m['a']:.6f}, b: {m['b']:.4f}, c: {m['c']:.4f}, d: {m['d']:.4f} }},")
print("  };")
print()
print("  const PERCENTILE_SIGMA = {")
for cat, sig in cat_sigmas.items():
    print(f"    {cat}: {sig},")
print("  };")
print("="*60)

# ── Validazione: errore medio su campione
print("\n=== Validazione campione (prime 20 gare per cat) ===")
for cat in ("short", "medium", "long", "ultra"):
    m = cat_models[cat]
    sample = [r for r in records if dist_cat(r["km"]) == cat][:20]
    if not sample:
        continue
    errors = []
    for r in sample:
        alt_km = r["alt_m"] / 1000.0
        pred = m["a"] * (r["km"]**m["b"]) * ((r["dplus"]/1000)**m["c"]) * math.exp(m["d"]*alt_km)
        err_pct = (pred - r["t_med"]) / r["t_med"] * 100
        errors.append(err_pct)
    mae = statistics.mean(abs(e) for e in errors)
    bias = statistics.mean(errors)
    print(f"  {cat:8s}: MAE={mae:.1f}%  bias={bias:+.1f}%")

# ── Plot diagnostico (opzionale — solo se matplotlib disponibile)
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    fig.suptitle("WizTrail Median Model — UTMB Dataset Fit", fontsize=13)

    for ax, cat in zip(axes.flat, ("short", "medium", "long", "ultra")):
        m = cat_models[cat]
        sample = [r for r in records if dist_cat(r["km"]) == cat]
        if not sample:
            continue
        actuals = []
        preds   = []
        for r in sample:
            alt_km = r["alt_m"] / 1000.0
            pred = m["a"] * (r["km"]**m["b"]) * ((r["dplus"]/1000)**m["c"]) * math.exp(m["d"]*alt_km)
            actuals.append(r["t_med"])
            preds.append(pred)
        ax.scatter(actuals, preds, alpha=0.2, s=5)
        mx = max(max(actuals), max(preds))
        ax.plot([0, mx], [0, mx], "r--", lw=1)
        ax.set_xlabel("Mediana reale (h)")
        ax.set_ylabel("Mediana prevista (h)")
        ax.set_title(f"{cat} ({len(sample)} gare)")

    plt.tight_layout()
    plot_path = PLOTS_DIR / "median_model_fit.png"
    plt.savefig(plot_path, dpi=120)
    print(f"\n📊  Plot salvato: {plot_path}")
except ImportError:
    print("\n  (matplotlib non disponibile — plot saltato)")
