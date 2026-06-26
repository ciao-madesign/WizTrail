"""
Script 02b — Timing Model vs. Realtà

Confronta le previsioni del modello WizTrail (wiztrail-timing.js, parametri attuali)
con i tempi reali delle gare nei due dataset:
  1. dataset.xlsx — tempi top100, avg_finish, top100_women
  2. kaggle_utmb_processed.csv — mediana storica delle stesse gare

Per ogni gara con GPX reale + tempo reale disponibile:
  - Parsing GPX → dists, eles
  - segment_time() con VELOCITY_PARAMS attuali → tempo stimato
  - Confronto con tempo reale → delta%, bias, RMSE
  - Confronto opzionale con mediana Kaggle (quando la gara è riconoscibile)

Output:
  data/timing_vs_reality.csv     — risultati per gara e per profilo atleta
  data/timing_vs_reality.json    — statistiche aggregate
  output/plots/timing_vs_reality.png — scatterplot + distribuzione errori
"""

import csv, json, math, re, statistics
import pandas as pd
import gpxpy
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path
from collections import defaultdict

DATA_DIR   = Path("data")
GPX_DIR    = Path("gpx")
OUTPUT_DIR = Path("output"); OUTPUT_DIR.mkdir(exist_ok=True)
PLOTS_DIR  = OUTPUT_DIR / "plots"; PLOTS_DIR.mkdir(exist_ok=True)

# ── Parametri attuali del modello (da wiztrail-timing.js — NON calibrati qui)
VELOCITY_PARAMS = (
    1.5,   # k_base
    2.5,   # k_spread
    1.6,   # cap_base
    0.9,   # cap_spread
    1.05,  # boost_base
    0.25,  # boost_S
    0.6,   # fatigue_coeff
)

TRAIL_BASE_FACTOR = {"Strada": 1.00, "E": 1.00, "EE": 0.85, "EA": 0.75}

ATHLETE_PROFILES = {
    "top100_men":   {"S": 0.85, "vel_base": 15.0, "col": "avg_top100_men_hours"},
    "avg_finish":   {"S": 0.40, "vel_base": 10.0, "col": "avg_finish_hours"},
    "top100_women": {"S": 0.80, "vel_base": 12.0, "col": "avg_top100_women_hours"},
}

# ─────────────────────────────────────────────────────────────────────────────
# Funzioni timing (riprese esattamente da 03_calibrate.py)
# ─────────────────────────────────────────────────────────────────────────────

def _hav(la1, lo1, la2, lo2):
    R = 6371000.; t = math.pi / 180
    dlat = (la2 - la1) * t; dlon = (lo2 - lo1) * t
    k = math.sin(dlat/2)**2 + math.cos(la1*t) * math.cos(la2*t) * math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(max(0, min(1, k))))

def _smooth(eles, w=2):
    out = []
    for i in range(len(eles)):
        s, c = 0, 0
        for k in range(-w, w+1):
            idx = i + k
            if 0 <= idx < len(eles): s += eles[idx]; c += 1
        out.append(s / c if c > 0 else eles[i])
    return out

def load_gpx(gpx_path):
    try:
        with open(gpx_path) as f: gpx = gpxpy.parse(f)
    except Exception:
        return None
    pts = []
    for t in gpx.tracks:
        for s in t.segments:
            for p in s.points:
                if p.elevation is not None:
                    pts.append((p.latitude, p.longitude, float(p.elevation)))
    if not pts:
        for r in gpx.routes:
            for p in r.points:
                if p.elevation is not None:
                    pts.append((p.latitude, p.longitude, float(p.elevation)))
    if len(pts) < 10:
        return None
    eles = [p[2] for p in pts]
    dists = [0.]
    for i in range(1, len(pts)):
        dists.append(dists[-1] + _hav(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1]))
    return dists, _smooth(eles, w=2)

def _vel_from_slope(p, S, vb, vp):
    if abs(p) < 0.015: return vb
    if p > 0:
        k   = vp[0] + vp[1] * (1 - S)
        cap = vp[2] + vp[3] * (1 - S)
        return vb / min(1 + k * p, cap)
    boost = vp[4] + vp[5] * S
    if p < -0.25:
        steep = (1 - S) * (abs(p) - 0.25) * 2
        return vb * max(boost - steep, 0.85)
    return vb * boost

def segment_time(dists, eles_s, vel_base, S, vp=VELOCITY_PARAMS):
    SEG = 80.; T = 0.; last_i = 0
    fc = vp[6]
    for i in range(1, len(dists)):
        d = dists[i] - dists[last_i]
        if d >= SEG:
            dh  = eles_s[i] - eles_s[last_i]
            slope = max(-0.35, min(0.35, dh / d))
            v   = _vel_from_slope(slope, S, vel_base, vp)
            t_raw = d / (v * 1000 / 3600)
            fat = min(1 + fc * math.pow(T / 3600 / 8, 1.2), 2.5)  # FATIGUE_CAP
            T += t_raw * fat; last_i = i
    return T  # secondi

# ─────────────────────────────────────────────────────────────────────────────
# Statistiche
# ─────────────────────────────────────────────────────────────────────────────

def rmse(deltas): return math.sqrt(statistics.mean(d**2 for d in deltas))
def mae(deltas):  return statistics.mean(abs(d) for d in deltas)

def dist_cat(km):
    if km <= 25:  return "short"
    if km <= 50:  return "medium"
    if km <= 95:  return "long"
    return "ultra"

def tech_tier(t):
    if t is None or t != t: return "unknown"
    if t < 3:  return "low (0-3)"
    if t < 6:  return "medium (3-6)"
    if t < 8:  return "high (6-8)"
    return "extreme (8-10)"

def dpkm_tier(dplus, km):
    r = dplus / max(km, 1)
    if r < 30:  return "gentle (<30 m/km)"
    if r < 60:  return "moderate (30-60)"
    if r < 100: return "steep (60-100)"
    return "skyrace (>100)"

# ─────────────────────────────────────────────────────────────────────────────
# Carica Kaggle UTMB per confronto mediana
# ─────────────────────────────────────────────────────────────────────────────

STOP = {"trail","ultra","run","race","marathon","km","mi","the","di","du","de","del","des","la","le","les","a","e","al","da"}
def tok(s):
    s = re.sub(r'\b\d{4}\b', '', s.lower())
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return {w for w in s.split() if len(w) >= 3 and w not in STOP}

def jaccard(a, b):
    if not a or not b: return 0.
    return len(a & b) / len(a | b)

print("⏳  Caricamento Kaggle UTMB…")
utmb_races = []
with open(DATA_DIR / "kaggle_utmb_processed.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        try:
            utmb_races.append({
                "title": row["race_title"],
                "km":    float(row["km"]),
                "dplus": float(row["dplus"]),
                "median_h": float(row["true_median_h"]),
                "n":     int(row["n_finishers"]),
                "_tok":  tok(row["race_title"]),
            })
        except (ValueError, KeyError): pass

def find_kaggle_match(name, km, dplus, threshold=0.35):
    name_tok = tok(name)
    best, best_r = None, 0.
    for u in utmb_races:
        if abs(u["km"] - km) / max(km, 1) > 0.15: continue
        sc = jaccard(name_tok, u["_tok"])
        if sc > best_r and sc >= threshold:
            best_r, best = sc, u
    return best, best_r

# ─────────────────────────────────────────────────────────────────────────────
# Carica prepared.csv e filtra gare utili
# ─────────────────────────────────────────────────────────────────────────────

print("⏳  Caricamento prepared.csv…")
df = pd.read_csv(DATA_DIR / "prepared.csv")

# Solo gare con GPX reale abbinato
df_gpx = df[df["calc_mode"] == "gpx"].copy()
print(f"  Gare con GPX: {len(df_gpx)}")

# ─────────────────────────────────────────────────────────────────────────────
# Analisi principale
# ─────────────────────────────────────────────────────────────────────────────

results = []   # una riga per (gara × profilo)

print("\n⏳  Calcolo timing su GPX reali…")
n_ok = 0

for _, row in df_gpx.iterrows():
    gpx_path = row.get("gpx_path")
    if not gpx_path or not Path(gpx_path).exists():
        continue

    gpx_data = load_gpx(gpx_path)
    if gpx_data is None:
        print(f"  ⚠  GPX non leggibile: {gpx_path}")
        continue

    dists, eles_s = gpx_data
    km_gpx   = dists[-1] / 1000
    # D+ dal GPX: somma incrementi positivi
    gain_gpx = sum(max(0, eles_s[i] - eles_s[i-1]) for i in range(1, len(eles_s)))
    dpkm     = gain_gpx / max(km_gpx, 1)

    race_name = str(row.get("race", ""))
    technicality = row.get("technicality")
    terrain_class = str(row.get("terrain_class", "E")) if pd.notna(row.get("terrain_class")) else "E"
    if terrain_class not in TRAIL_BASE_FACTOR: terrain_class = "E"
    reliability = float(row.get("time_reliability", 1.0)) if pd.notna(row.get("time_reliability")) else 1.0
    feed_aff    = float(row.get("feedback_affidability", 0.8)) if pd.notna(row.get("feedback_affidability")) else 0.8

    # Match Kaggle
    km_ref    = float(row["distance_km"]) if pd.notna(row.get("distance_km")) else km_gpx
    dplus_ref = float(row["elevation_m"])  if pd.notna(row.get("elevation_m"))  else gain_gpx
    kaggle_match, kaggle_score = find_kaggle_match(race_name, km_ref, dplus_ref)

    has_real = False
    for prof_name, prof in ATHLETE_PROFILES.items():
        real_h = row.get(prof["col"])
        if pd.isna(real_h): continue
        real_h = float(real_h)
        if real_h <= 0: continue

        vb_eff = prof["vel_base"] * TRAIL_BASE_FACTOR.get(terrain_class, 1.0)
        est_s  = segment_time(dists, eles_s, vb_eff, prof["S"])
        est_h  = est_s / 3600
        delta_pct = (est_h - real_h) / real_h * 100

        has_real = True
        entry = {
            "race":           race_name,
            "gpx_id":         str(row.get("gpx_id", "")),
            "km_gpx":         round(km_gpx, 2),
            "dplus_gpx":      round(gain_gpx, 0),
            "dpkm":           round(dpkm, 1),
            "technicality":   technicality if pd.notna(technicality) else None,
            "terrain_class":  terrain_class,
            "dist_cat":       dist_cat(km_gpx),
            "tech_tier":      tech_tier(technicality if pd.notna(technicality) else None),
            "dpkm_tier":      dpkm_tier(gain_gpx, km_gpx),
            "profile":        prof_name,
            "S":              prof["S"],
            "vel_base":       prof["vel_base"],
            "est_h":          round(est_h, 3),
            "real_h":         round(real_h, 3),
            "delta_pct":      round(delta_pct, 2),
            "reliability":    reliability,
            "feed_affidability": feed_aff,
        }

        # Confronto con Kaggle (solo per profilo avg_finish → mediana più comparabile)
        if kaggle_match and prof_name == "avg_finish":
            entry["kaggle_title"]   = kaggle_match["title"]
            entry["kaggle_median_h"]= round(kaggle_match["median_h"], 3)
            entry["kaggle_score"]   = round(kaggle_score, 3)
            kd = (est_h - kaggle_match["median_h"]) / kaggle_match["median_h"] * 100
            entry["delta_vs_kaggle_pct"] = round(kd, 2)
        else:
            entry["kaggle_title"]   = ""
            entry["kaggle_median_h"]= None
            entry["kaggle_score"]   = None
            entry["delta_vs_kaggle_pct"] = None

        results.append(entry)

    if has_real: n_ok += 1

print(f"  Gare analizzate: {n_ok}")
print(f"  Voci totali (gara × profilo): {len(results)}")

if not results:
    print("❌  Nessun risultato — verifica prepared.csv e colonne tempi")
    exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# Statistiche aggregate
# ─────────────────────────────────────────────────────────────────────────────

def stats_group(rows, label=""):
    deltas = [r["delta_pct"] for r in rows]
    if not deltas: return {}
    return {
        "n":        len(deltas),
        "mae":      round(mae(deltas), 2),
        "rmse":     round(rmse(deltas), 2),
        "bias":     round(statistics.mean(deltas), 2),
        "median_delta": round(statistics.median(deltas), 2),
        "pct_within_10": round(100 * sum(1 for d in deltas if abs(d) < 10) / len(deltas), 1),
        "pct_within_20": round(100 * sum(1 for d in deltas if abs(d) < 20) / len(deltas), 1),
        "over_pct":  round(100 * sum(1 for d in deltas if d > 0) / len(deltas), 1),
    }

report = {"overall": {}, "by_profile": {}, "by_dist_cat": {}, "by_tech_tier": {}, "by_dpkm_tier": {}, "kaggle_comparison": {}}

report["overall"] = stats_group(results, "all")

for prof in ATHLETE_PROFILES:
    rows = [r for r in results if r["profile"] == prof]
    report["by_profile"][prof] = stats_group(rows)

for cat in ("short", "medium", "long", "ultra"):
    rows = [r for r in results if r["dist_cat"] == cat]
    report["by_dist_cat"][cat] = stats_group(rows)

for tier in sorted({r["tech_tier"] for r in results}):
    rows = [r for r in results if r["tech_tier"] == tier]
    report["by_tech_tier"][tier] = stats_group(rows)

for tier in sorted({r["dpkm_tier"] for r in results}):
    rows = [r for r in results if r["dpkm_tier"] == tier]
    report["by_dpkm_tier"][tier] = stats_group(rows)

# Confronto con Kaggle (solo avg_finish con match)
kaggle_rows = [r for r in results if r["profile"] == "avg_finish" and r["delta_vs_kaggle_pct"] is not None]
if kaggle_rows:
    kd = [r["delta_vs_kaggle_pct"] for r in kaggle_rows]
    report["kaggle_comparison"] = {
        "n_matched": len(kaggle_rows),
        "mae_vs_kaggle": round(mae(kd), 2),
        "bias_vs_kaggle": round(statistics.mean(kd), 2),
        "rmse_vs_kaggle": round(rmse(kd), 2),
    }

# ─────────────────────────────────────────────────────────────────────────────
# Stampa risultati
# ─────────────────────────────────────────────────────────────────────────────

print("\n" + "=" * 80)
print("RISULTATI GLOBALI")
print("=" * 80)
g = report["overall"]
print(f"  Osservazioni totali:   {g['n']}")
print(f"  MAE:                   {g['mae']:.1f}%")
print(f"  RMSE:                  {g['rmse']:.1f}%")
print(f"  Bias (sovra/sotto):    {g['bias']:+.1f}%  {'← modello SOVRASTIMA' if g['bias']>0 else '← modello SOTTOSTIMA'}")
print(f"  Mediana errore:        {g['median_delta']:+.1f}%")
print(f"  Entro ±10%:            {g['pct_within_10']}%")
print(f"  Entro ±20%:            {g['pct_within_20']}%")
print(f"  % previsioni in eccesso: {g['over_pct']}%")

print("\n── Per profilo atleta ──────────────────────────────────────")
for pname, s in report["by_profile"].items():
    if not s: continue
    print(f"  {pname:15s}  n={s['n']:3d}  MAE={s['mae']:5.1f}%  bias={s['bias']:+5.1f}%  within20={s['pct_within_20']}%")

print("\n── Per categoria distanza ──────────────────────────────────")
for cat, s in report["by_dist_cat"].items():
    if not s: continue
    print(f"  {cat:8s}  n={s['n']:3d}  MAE={s['mae']:5.1f}%  bias={s['bias']:+5.1f}%  within20={s['pct_within_20']}%")

print("\n── Per tecnicità ────────────────────────────────────────────")
for tier, s in report["by_tech_tier"].items():
    if not s: continue
    print(f"  {tier:22s}  n={s['n']:3d}  MAE={s['mae']:5.1f}%  bias={s['bias']:+5.1f}%  within20={s['pct_within_20']}%")

print("\n── Per D+/km ────────────────────────────────────────────────")
for tier, s in report["by_dpkm_tier"].items():
    if not s: continue
    print(f"  {tier:28s}  n={s['n']:3d}  MAE={s['mae']:5.1f}%  bias={s['bias']:+5.1f}%  within20={s['pct_within_20']}%")

if kaggle_rows:
    k = report["kaggle_comparison"]
    print(f"\n── vs Kaggle mediana ({k['n_matched']} gare matchate) ──────────────────")
    print(f"  MAE vs Kaggle:   {k['mae_vs_kaggle']:.1f}%")
    print(f"  Bias vs Kaggle:  {k['bias_vs_kaggle']:+.1f}%")
    print(f"  RMSE vs Kaggle:  {k['rmse_vs_kaggle']:.1f}%")

# ─────────────────────────────────────────────────────────────────────────────
# Tabella per-gara (avg_finish)
# ─────────────────────────────────────────────────────────────────────────────

print("\n── Dettaglio per gara (profilo avg_finish) ─────────────────────────────────────────────")
print(f"{'Gara':40s}  {'km':>5}  {'D+':>5}  {'D+/km':>5}  {'tech':>4}  {'real_h':>7}  {'est_h':>7}  {'Δ%':>6}  {'Kaggle_h':>8}  {'Δ_K%':>6}")
print("-" * 120)
af_rows = sorted([r for r in results if r["profile"] == "avg_finish"], key=lambda x: x["delta_pct"])
for r in af_rows:
    kh  = f"{r['kaggle_median_h']:.2f}" if r.get("kaggle_median_h") else "—"
    kd  = f"{r['delta_vs_kaggle_pct']:+.1f}%" if r.get("delta_vs_kaggle_pct") is not None else "—"
    tech_s = f"{r['technicality']:.1f}" if r.get("technicality") else "—"
    print(
        f"{r['race'][:39]:40s}  {r['km_gpx']:>5.1f}  {r['dplus_gpx']:>5.0f}  "
        f"{r['dpkm']:>5.0f}  {tech_s:>4s}  {r['real_h']:>7.2f}  {r['est_h']:>7.2f}  "
        f"{r['delta_pct']:>+6.1f}%  {kh:>8s}  {kd:>6s}"
    )

# ─────────────────────────────────────────────────────────────────────────────
# Plot
# ─────────────────────────────────────────────────────────────────────────────

fig, axes = plt.subplots(2, 3, figsize=(16, 10))
fig.suptitle("WizTrail Timing Model vs. Realtà", fontsize=14, fontweight="bold")
COLORS = {"top100_men": "#4CAF50", "avg_finish": "#2196F3", "top100_women": "#E91E63"}

# 1. Scatter: stimato vs reale (per profilo)
ax = axes[0, 0]
for pname, color in COLORS.items():
    pts = [(r["real_h"], r["est_h"]) for r in results if r["profile"] == pname]
    if pts:
        x, y = zip(*pts)
        ax.scatter(x, y, label=pname, color=color, alpha=0.6, s=30)
mx = max(r["real_h"] for r in results) * 1.05
ax.plot([0, mx], [0, mx], "k--", lw=1, alpha=0.4, label="perfetto")
ax.set_xlabel("Tempo reale (h)"); ax.set_ylabel("Tempo stimato (h)")
ax.set_title("Stimato vs Reale"); ax.legend(fontsize=8); ax.grid(alpha=0.3)

# 2. Distribuzione errori
ax = axes[0, 1]
all_deltas = [r["delta_pct"] for r in results]
ax.hist(all_deltas, bins=30, color="#607D8B", alpha=0.8, edgecolor="white")
ax.axvline(0, color="red", lw=1.5, linestyle="--")
ax.axvline(statistics.mean(all_deltas), color="orange", lw=1.5, linestyle="-", label=f"bias {statistics.mean(all_deltas):+.1f}%")
ax.set_xlabel("Errore %  (stimato - reale) / reale"); ax.set_ylabel("Frequenza")
ax.set_title("Distribuzione errori (tutti i profili)"); ax.legend(fontsize=8); ax.grid(alpha=0.3)

# 3. Bias per categoria distanza
ax = axes[0, 2]
cats = [c for c in ("short", "medium", "long", "ultra") if report["by_dist_cat"].get(c)]
biases_dist = [report["by_dist_cat"][c]["bias"] for c in cats]
maes_dist   = [report["by_dist_cat"][c]["mae"]  for c in cats]
x_pos = range(len(cats))
bars = ax.bar(x_pos, biases_dist, color=["green" if b < 0 else "salmon" for b in biases_dist], alpha=0.8)
ax.axhline(0, color="black", lw=1)
ax.set_xticks(x_pos); ax.set_xticklabels(cats)
ax.set_ylabel("Bias medio %"); ax.set_title("Bias per categoria distanza"); ax.grid(axis="y", alpha=0.3)
for bar, mae_val in zip(bars, maes_dist):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, f"MAE={mae_val:.0f}%", ha="center", fontsize=8)

# 4. Bias per tecnicità
ax = axes[1, 0]
tech_tiers_list = [t for t in ("low (0-3)", "medium (3-6)", "high (6-8)", "extreme (8-10)") if report["by_tech_tier"].get(t)]
biases_tech = [report["by_tech_tier"][t]["bias"] for t in tech_tiers_list]
maes_tech   = [report["by_tech_tier"][t]["mae"]  for t in tech_tiers_list]
x_pos = range(len(tech_tiers_list))
bars = ax.bar(x_pos, biases_tech, color=["green" if b < 0 else "salmon" for b in biases_tech], alpha=0.8)
ax.axhline(0, color="black", lw=1)
ax.set_xticks(x_pos); ax.set_xticklabels([t.replace(" (", "\n(") for t in tech_tiers_list], fontsize=8)
ax.set_ylabel("Bias medio %"); ax.set_title("Bias per livello tecnicità"); ax.grid(axis="y", alpha=0.3)
for bar, mae_val in zip(bars, maes_tech):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, f"MAE={mae_val:.0f}%", ha="center", fontsize=8)

# 5. Scatter: errore vs D+/km
ax = axes[1, 1]
for pname, color in COLORS.items():
    pts = [(r["dpkm"], r["delta_pct"]) for r in results if r["profile"] == pname]
    if pts:
        x, y = zip(*pts)
        ax.scatter(x, y, label=pname, color=color, alpha=0.5, s=25)
ax.axhline(0, color="red", lw=1, linestyle="--")
ax.set_xlabel("D+/km"); ax.set_ylabel("Errore %")
ax.set_title("Errore vs D+/km (tecnicità)"); ax.legend(fontsize=8); ax.grid(alpha=0.3)

# 6. Confronto con Kaggle (avg_finish)
ax = axes[1, 2]
if kaggle_rows:
    kd_vals = [r["delta_vs_kaggle_pct"] for r in kaggle_rows]
    ax.hist(kd_vals, bins=20, color="#FF9800", alpha=0.8, edgecolor="white")
    ax.axvline(0, color="red", lw=1.5, linestyle="--")
    ax.axvline(statistics.mean(kd_vals), color="black", lw=1.5, linestyle="-",
               label=f"bias {statistics.mean(kd_vals):+.1f}%")
    ax.set_xlabel("Errore % vs mediana Kaggle"); ax.set_ylabel("Frequenza")
    ax.set_title(f"Stimato vs Kaggle mediana\n(avg_finish, n={len(kaggle_rows)})"); ax.legend(fontsize=8); ax.grid(alpha=0.3)
else:
    ax.text(0.5, 0.5, "Nessun match Kaggle\ndisponibile", ha="center", va="center", transform=ax.transAxes)
    ax.set_title("vs Kaggle mediana")

plt.tight_layout()
plot_path = PLOTS_DIR / "timing_vs_reality.png"
plt.savefig(plot_path, dpi=130)
print(f"\n📊  Plot: {plot_path}")

# ─────────────────────────────────────────────────────────────────────────────
# Salva output
# ─────────────────────────────────────────────────────────────────────────────

out_csv = DATA_DIR / "timing_vs_reality.csv"
if results:
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=results[0].keys())
        w.writeheader(); w.writerows(results)

with open(DATA_DIR / "timing_vs_reality.json", "w") as f:
    json.dump(report, f, indent=2)

print(f"📄  {out_csv}")
print(f"📄  {DATA_DIR / 'timing_vs_reality.json'}")
