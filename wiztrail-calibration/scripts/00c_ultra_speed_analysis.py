"""
Script 00c — Analisi distribuzione velocità da dataset ultra-marathon

Fonte: The Big Dataset of Ultra Marathon Running, aiaiaidavid (Kaggle)
       https://www.kaggle.com/datasets/aiaiaidavid/the-big-dataset-of-ultra-marathon-running
Licenza: CC0 Public Domain

Input:  data/kaggle/TWO_CENTURIES_OF_UM_RACES.csv

Nota: questo dataset non ha dati di D+ → non può migliorare direttamente
il modello mediana di WizTrail (che dipende da km + D+). Viene usato per:
  - Validare le assunzioni di velocità base (velBase) per distanza
  - Riferimento per future correzioni età/genere
  - Cross-check su 50km / 100km / 50mi / 100mi

Output:
  - Stampa distribuzioni velocità per distanza (p10, p25, mediana, p75, p90)
  - Salva data/ultra_speed_distributions.json
"""

import csv
import json
import math
import statistics
from pathlib import Path

INPUT_CSV   = Path("data/kaggle/TWO_CENTURIES_OF_UM_RACES.csv")
OUTPUT_JSON = Path("data/ultra_speed_distributions.json")

TARGET_DISTANCES = {"50km", "100km", "50mi", "100mi", "80km", "60km", "90km"}
MI_TO_KM = 1.60934

def km_from_dist(d):
    if d.endswith("mi"):
        try: return float(d[:-2]) * MI_TO_KM
        except ValueError: return None
    if d.endswith("km"):
        try: return float(d[:-2])
        except ValueError: return None
    return None

print("⏳  Caricamento dati…")
buckets = {}  # distanza → lista velocità km/h

with open(INPUT_CSV, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        dist = (row.get("Event distance/length") or "").strip()
        if dist not in TARGET_DISTANCES:
            continue
        try:
            spd = float(row["Athlete average speed"])
            if 1.0 < spd < 30.0:
                buckets.setdefault(dist, []).append(spd)
        except (ValueError, TypeError):
            pass

print(f"  Distanze trovate: {sorted(buckets.keys())}\n")

result = {}
print(f"{'Distanza':8s}  {'n':>7s}  {'p10':>5s}  {'p25':>5s}  {'med':>5s}  {'p75':>5s}  {'p90':>5s}  km")
print("-" * 65)

for dist in sorted(buckets.keys(), key=lambda d: km_from_dist(d) or 0):
    speeds = sorted(buckets[dist])
    n = len(speeds)
    p = lambda q: speeds[int(n * q)]

    km_eq = km_from_dist(dist)
    print(f"{dist:8s}  {n:>7,}  {p(0.10):>5.2f}  {p(0.25):>5.2f}  "
          f"{statistics.median(speeds):>5.2f}  {p(0.75):>5.2f}  {p(0.90):>5.2f}  "
          f"({km_eq:.0f} km)" if km_eq else "")

    result[dist] = {
        "km_equivalent": km_eq,
        "n": n,
        "p10": round(p(0.10), 3),
        "p25": round(p(0.25), 3),
        "median": round(statistics.median(speeds), 3),
        "p75": round(p(0.75), 3),
        "p90": round(p(0.90), 3),
        "mean": round(statistics.mean(speeds), 3),
    }

OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT_JSON, "w") as f:
    json.dump({
        "source": "The Big Dataset of Ultra Marathon Running, aiaiaidavid (Kaggle)",
        "license": "CC0 Public Domain",
        "note": "Include gare road + trail — velocità NON comparabili direttamente con modello WizTrail (no D+)",
        "speeds_kmh": result,
    }, f, indent=2)

print(f"\n📄  Distribuzioni salvate: {OUTPUT_JSON}")
print("\nNota: mediana 50km ~7.6 km/h include road ultra (velBase trail ~6-8 km/h — coerente)")
