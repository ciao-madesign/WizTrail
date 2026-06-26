"""
Script 01 — Cross-validazione dataset UTMB × Ultra Marathon (Two Centuries)

Strategia:
  1. Carica dati UTMB processati (km, D+, mediana ore, n_finisher, race_title, year)
  2. Aggrega Two Centuries a livello gara: mediana performance per (event, distance, year)
  3. Fuzzy-match per nome normalizzato + distanza (±10%) + anno
  4. Per le gare matchate: confronta mediane, calcola RMSE e bias del modello WizTrail

Output:
  - Tabella match con delta %
  - RMSE / MAE / bias sulle gare cross-validate
  - data/cross_validation_matches.csv
  - data/cross_validation_report.json
"""

import csv
import json
import math
import re
import statistics
from pathlib import Path

UTMB_CSV   = Path("data/kaggle_utmb_processed.csv")
ULTRA_CSV  = Path("data/kaggle/TWO_CENTURIES_OF_UM_RACES.csv")
OUT_CSV    = Path("data/cross_validation_matches.csv")
OUT_JSON   = Path("data/cross_validation_report.json")

JACCARD_THRESHOLD = 0.30  # similarità minima nome (Jaccard su token)
DIST_TOL          = 0.12  # tolleranza distanza ±12%
YEAR_WINDOW       = 2     # ±2 anni per match cross-dataset


# ── Normalizza + tokenizza nome gara → set di parole significative
STOP_WORDS = {'trail','ultra','run','race','marathon','km','mi','edition',
              'the','di','du','de','del','des','la','le','les','da','al','a','e'}

def norm_tokens(s):
    s = s.lower()
    s = re.sub(r'\b\d{4}\b', '', s)            # rimuovi anni 4 cifre
    s = re.sub(r'\([a-z]{2,3}\)\s*$', '', s)   # rimuovi (FRA) (ITA) ecc.
    s = re.sub(r'[^a-z0-9 ]', ' ', s)          # solo alfanumerico
    tokens = {t for t in s.split() if len(t) >= 3 and t not in STOP_WORDS}
    return tokens

def jaccard(a_tokens, b_tokens):
    if not a_tokens or not b_tokens:
        return 0.0
    inter = len(a_tokens & b_tokens)
    union = len(a_tokens | b_tokens)
    return inter / union if union else 0.0


# ── Parsa performance "4:51:39 h" → ore float
def parse_perf_h(s):
    if not s:
        return None
    s = s.strip().rstrip(' h').strip()
    parts = s.split(':')
    try:
        if len(parts) == 3:
            return int(parts[0]) + int(parts[1]) / 60 + float(parts[2]) / 3600
        if len(parts) == 2:
            return int(parts[0]) + int(parts[1]) / 60
    except (ValueError, IndexError):
        pass
    return None


# ── Distanza in km da stringa
def dist_km(s):
    if not s:
        return None
    s = s.strip()
    if s.endswith('mi'):
        try: return float(s[:-2]) * 1.60934
        except ValueError: return None
    if s.endswith('km'):
        try: return float(s[:-2])
        except ValueError: return None
    try:
        return float(s)
    except ValueError:
        return None


# ════════════════════════════════════════════════════
# 1. CARICA UTMB
# ════════════════════════════════════════════════════
print("⏳  Caricamento UTMB…")
utmb_races = []
with open(UTMB_CSV, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        try:
            utmb_races.append({
                "title":   row["race_title"].strip(),
                "km":      float(row["km"]),
                "dplus":   float(row["dplus"]),
                "alt_m":   float(row["alt_m"]) if row["alt_m"] else 0,
                "median_h": float(row["true_median_h"]),
                "n":       int(row["n_finishers"]),
                "year":    int(row["year"]) if row["year"] else 0,
                "country": row["country"],
                "_tok":    norm_tokens(row["race_title"]),
            })
        except (ValueError, KeyError):
            pass
print(f"  UTMB races: {len(utmb_races)}")


# ════════════════════════════════════════════════════
# 2. AGGREGA TWO CENTURIES → livello gara
# ════════════════════════════════════════════════════
print("⏳  Aggregazione Two Centuries per evento…")
from collections import defaultdict

race_times = defaultdict(list)   # (name, dist_str, year) → [ore]

with open(ULTRA_CSV, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        name  = (row["Event name"] or "").strip()
        dist  = (row["Event distance/length"] or "").strip()
        yr_s  = (row["Year of event"] or "").strip()
        perf  = parse_perf_h(row["Athlete performance"])
        if not name or not dist or perf is None:
            continue
        # Filtra: solo distanze in km/mi (non timed races come 6h, 24h)
        if not (dist.endswith("km") or dist.endswith("mi")):
            continue
        km = dist_km(dist)
        if km is None or km < 10:
            continue
        try:
            yr = int(yr_s)
        except ValueError:
            yr = 0
        if not (0.3 < perf < 100):
            continue
        race_times[(name, dist, yr)].append(perf)

# Tieni solo gare con ≥8 finisher e mediana plausibile
ultra_races = []
for (name, dist, yr), times in race_times.items():
    if len(times) < 8:
        continue
    med = statistics.median(times)
    km  = dist_km(dist)
    if km and 0.5 <= med <= 80:
        ultra_races.append({
            "title":    name,
            "km":       km,
            "dist_str": dist,
            "median_h": med,
            "n":        len(times),
            "year":     yr,
            "_tok":     norm_tokens(name),
        })

print(f"  Ultra races (aggregated): {len(ultra_races)}")


# ════════════════════════════════════════════════════
# 3. FUZZY MATCHING (iterazione sul lato piccolo: 2201 ultra)
#    Indice UTMB per distanza → confronto Jaccard su token
# ════════════════════════════════════════════════════
print("⏳  Fuzzy matching…")

def dist_bucket(km):
    return round(km / 5) * 5

# Indice UTMB per bucket di distanza
utmb_by_dist = defaultdict(list)
for r in utmb_races:
    utmb_by_dist[dist_bucket(r["km"])].append(r)

matched_utmb_ids = set()  # evita duplicati: una gara UTMB matchata una sola volta
matches = []

for ultra in ultra_races:
    best_score = 0
    best_match = None

    buckets = [dist_bucket(ultra["km"]) + d for d in (-10, -5, 0, 5, 10)]
    candidates = []
    for b in buckets:
        candidates.extend(utmb_by_dist.get(b, []))

    for utmb in candidates:
        # 1. Filtro distanza ±12%
        dist_ratio = abs(utmb["km"] - ultra["km"]) / max(utmb["km"], 1)
        if dist_ratio > DIST_TOL:
            continue

        # 2. Filtro anno (±2 anni, 0 = ignoto)
        if utmb["year"] and ultra["year"]:
            if abs(utmb["year"] - ultra["year"]) > YEAR_WINDOW:
                continue

        # 3. Jaccard su token (veloce: set intersection/union)
        score = jaccard(utmb["_tok"], ultra["_tok"])
        if score > best_score and score >= JACCARD_THRESHOLD:
            best_score = score
            best_match = utmb

    if best_match:
        delta_pct = (ultra["median_h"] - best_match["median_h"]) / best_match["median_h"] * 100
        matches.append({
            "utmb_title":    best_match["title"],
            "ultra_title":   ultra["title"],
            "km":            best_match["km"],
            "dplus":         best_match["dplus"],
            "year_utmb":     best_match["year"],
            "year_ultra":    ultra["year"],
            "utmb_median_h": round(best_match["median_h"], 3),
            "ultra_median_h":round(ultra["median_h"], 3),
            "n_utmb":        best_match["n"],
            "n_ultra":       ultra["n"],
            "delta_pct":     round(delta_pct, 1),
            "match_score":   round(best_score, 3),
        })

matches.sort(key=lambda x: x["match_score"], reverse=True)
print(f"  Match trovati: {len(matches)}")


# ════════════════════════════════════════════════════
# 4. STAMPA + STATISTICHE
# ════════════════════════════════════════════════════
print()
print("=" * 110)
print(f"{'UTMB race':45s}  {'Ultra race':35s}  {'km':>5}  {'D+':>5}  {'UTMB med':>8}  {'Ultra med':>9}  {'Δ%':>5}  {'sc':>4}")
print("-" * 110)

for m in matches[:50]:
    utmb_h  = f"{int(m['utmb_median_h'])}:{int((m['utmb_median_h']%1)*60):02d}"
    ultra_h = f"{int(m['ultra_median_h'])}:{int((m['ultra_median_h']%1)*60):02d}"
    print(
        f"{m['utmb_title'][:44]:45s}  {m['ultra_title'][:34]:35s}  "
        f"{m['km']:>5.1f}  {m['dplus']:>5.0f}  "
        f"{utmb_h:>8s}  {ultra_h:>9s}  {m['delta_pct']:>+5.1f}%  {m['match_score']:.2f}"
    )

if len(matches) > 50:
    print(f"  … e altri {len(matches)-50} match")

# Statistiche sui delta
if matches:
    deltas = [abs(m["delta_pct"]) for m in matches]
    biases = [m["delta_pct"] for m in matches]
    print()
    print("=" * 60)
    print("STATISTICHE CROSS-VALIDAZIONE")
    print("=" * 60)
    print(f"  Match totali:       {len(matches)}")
    print(f"  MAE  delta%:        {statistics.mean(deltas):.1f}%")
    print(f"  Mediana delta%:     {statistics.median(deltas):.1f}%")
    print(f"  Bias medio:         {statistics.mean(biases):+.1f}%")
    print(f"  Match con |Δ|<10%:  {sum(1 for d in deltas if d < 10)} ({100*sum(1 for d in deltas if d < 10)/len(deltas):.0f}%)")
    print(f"  Match con |Δ|<20%:  {sum(1 for d in deltas if d < 20)} ({100*sum(1 for d in deltas if d < 20)/len(deltas):.0f}%)")
    print(f"  Match con |Δ|>30%:  {sum(1 for d in deltas if d > 30)} ({100*sum(1 for d in deltas if d > 30)/len(deltas):.0f}%)")

    # RMSE
    rmse = math.sqrt(statistics.mean([(m["delta_pct"])**2 for m in matches]))
    print(f"  RMSE delta%:        {rmse:.1f}%")


# ════════════════════════════════════════════════════
# 5. SALVA OUTPUT
# ════════════════════════════════════════════════════
with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
    if matches:
        w = csv.DictWriter(f, fieldnames=matches[0].keys())
        w.writeheader()
        w.writerows(matches)

with open(OUT_JSON, "w") as f:
    json.dump({
        "n_matches": len(matches),
        "mae_pct":   round(statistics.mean(deltas), 2) if matches else None,
        "bias_pct":  round(statistics.mean(biases), 2) if matches else None,
        "rmse_pct":  round(rmse, 2) if matches else None,
        "top_matches": matches[:20],
    }, f, indent=2)

print(f"\n📄  {OUT_CSV}")
print(f"📄  {OUT_JSON}")
