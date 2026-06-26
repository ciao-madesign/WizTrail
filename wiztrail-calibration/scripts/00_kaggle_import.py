"""
Script 00 — Import e pulizia dataset UTMB da Kaggle

Fonte: UTMB World Race Data, Maarten Poirot
       https://www.kaggle.com/datasets/mgpoirot/utmb-world-race-daa
Dati originali: UTMB World (utmb.world) — risultati gare pubblici

Uso: calibrazione offline del modello di stima tempi WizTrail.
     Il dataset raw NON viene ridistribuito; vengono usati solo
     i coefficienti derivati (MEDIAN_MODEL, PERCENTILE_SIGMA).

Output:
  data/kaggle_utmb_processed.csv
    km, dplus, alt_m, true_median_h, true_mean_h, sigma_log,
    n_finishers, year, race_title, country, lat, lon

Filtri applicati:
  - km >= 10 e km <= 300
  - D+/km >= 20 m/km (carattere trail/montagna, esclude road)
  - D+ >= 200 m
  - true_median_h tra 0.5h e 80h
  - n_finishers >= 10
"""

import csv
import json
import math
import statistics
from pathlib import Path

KAGGLE_DIR   = Path("data/kaggle")
OUTPUT_CSV   = Path("data/kaggle_utmb_processed.csv")

CSV_FILE  = KAGGLE_DIR / "utmb-race-data-sheet.csv"
JSON_FILE = KAGGLE_DIR / "utmb-race-data-raw.json"

# ── Carica CSV aggregato
print("⏳  Caricamento CSV…")
with open(CSV_FILE, encoding="utf-8") as f:
    csv_rows = {r["Race UID"] + "." + r["Year"]: r for r in csv.DictReader(f)}

# ── Carica JSON con Results individuali
print("⏳  Caricamento JSON (può richiedere qualche secondo)…")
with open(JSON_FILE, encoding="utf-8") as f:
    json_data = json.load(f)

print(f"  CSV: {len(csv_rows)} righe")
print(f"  JSON: {len(json_data)} gare")

# ── Funzione: safe parse float
def flt(v, default=None):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (ValueError, TypeError):
        return default

# ── Merge e filtro
records = []
skipped = {"no_results": 0, "short": 0, "road": 0, "bad_time": 0, "few_fin": 0}

for key, jrace in json_data.items():
    results = jrace.get("Results", [])
    if not results:
        skipped["no_results"] += 1
        continue

    # Recupera campi dal CSV (lookup per chiave Race_UID.Year)
    crow = csv_rows.get(key, {})

    # Distanza: prende dal CSV o dal JSON
    km_raw  = crow.get("Distance") or ""
    dplus_raw = crow.get("Elevation Gain") or ""
    # Il JSON ha "12 KM", "400 M+" — normalizza
    if not km_raw:
        km_raw = str(jrace.get("Distance", "")).replace("KM","").replace("km","").strip()
    if not dplus_raw:
        dplus_raw = str(jrace.get("Elevation Gain","")).replace("M+","").replace("m+","").strip()

    km    = flt(str(km_raw).replace("KM","").replace("km","").split()[0] if km_raw else None)
    dplus = flt(str(dplus_raw).replace("M+","").replace("m+","").split()[0] if dplus_raw else None)

    if km is None or km < 10 or km > 300:
        skipped["short"] += 1
        continue

    if dplus is None or dplus < 200:
        skipped["road"] += 1
        continue

    dplus_per_km = dplus / km
    if dplus_per_km < 20:
        skipped["road"] += 1
        continue

    # Risultati individuali
    clean_results = [r for r in results if isinstance(r, (int, float)) and 0.3 < r < 100]
    if len(clean_results) < 10:
        skipped["few_fin"] += 1
        continue

    true_median = statistics.median(clean_results)
    true_mean   = statistics.mean(clean_results)

    if not (0.5 <= true_median <= 80):
        skipped["bad_time"] += 1
        continue

    # Sigma log-normale: log dei tempi → deviazione standard
    log_times = [math.log(t) for t in clean_results]
    sigma_log = statistics.stdev(log_times) if len(log_times) > 1 else 0.30

    # Quota (m slm) — Elevation nel CSV
    alt_m = flt(crow.get("Elevation")) or 0.0

    records.append({
        "km":            round(km, 2),
        "dplus":         round(dplus, 0),
        "alt_m":         round(alt_m, 0),
        "true_median_h": round(true_median, 4),
        "true_mean_h":   round(true_mean, 4),
        "sigma_log":     round(sigma_log, 4),
        "n_finishers":   len(clean_results),
        "year":          crow.get("Year", ""),
        "race_title":    jrace.get("Race Title", crow.get("Race Title", "")),
        "country":       crow.get("Country", ""),
        "lat":           flt(crow.get("Latitude"))  or "",
        "lon":           flt(crow.get("Longitude")) or "",
    })

# ── Salva CSV processato
FIELDS = ["km","dplus","alt_m","true_median_h","true_mean_h","sigma_log",
          "n_finishers","year","race_title","country","lat","lon"]

with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(records)

print(f"\n✅  Gare esportate: {len(records)}")
print(f"   Scartate — no results: {skipped['no_results']}")
print(f"   Scartate — road/poco D+: {skipped['road']}")
print(f"   Scartate — troppo corte/lunghe: {skipped['short']}")
print(f"   Scartate — tempo anomalo: {skipped['bad_time']}")
print(f"   Scartate — pochi finisher: {skipped['few_fin']}")
print(f"\n📄  Output: {OUTPUT_CSV}")

# Statistiche rapide
kms   = [r["km"]           for r in records]
dpks  = [r["dplus"]/r["km"] for r in records]
meds  = [r["true_median_h"] for r in records]
sigs  = [r["sigma_log"]    for r in records]
print(f"\nStatistiche dataset processato:")
print(f"  km:          {min(kms):.0f} – {max(kms):.0f}  (mediana {statistics.median(kms):.0f})")
print(f"  D+/km:       {min(dpks):.0f} – {max(dpks):.0f}  (mediana {statistics.median(dpks):.0f})")
print(f"  median_h:    {min(meds):.2f} – {max(meds):.2f}  (mediana {statistics.median(meds):.2f})")
print(f"  sigma_log:   {min(sigs):.3f} – {max(sigs):.3f}  (media {statistics.mean(sigs):.3f})")
