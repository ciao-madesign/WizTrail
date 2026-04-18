"""
Script 01 — Prepara dataset + abbina GPX reali
Regole:
  - gpx_id + file trovato  → modalità GPX
  - no gpx ma dist/d+ presenti → modalità manuale
  - nessun dato geometrico → tech_only (esclusa da WDI)
  - avg_finish_hours NaN  → esclusa dalla calibrazione tempi
"""
import json, sys
import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path("data")
GPX_DIR  = Path("gpx")

xlsx_files = sorted(DATA_DIR.glob("*.xlsx")) + sorted(DATA_DIR.glob("*.xls"))
if not xlsx_files:
    print("❌  Nessun file Excel in data/"); sys.exit(1)

df = pd.read_excel(xlsx_files[0])
df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
print(f"  📂  {xlsx_files[0].name}  →  {len(df)} gare")

for col in ["distance_km","elevation_m","technicality","feedback_affidability",
            "avg_top100_men_hours","avg_top100_women_hours","best_time_hours",
            "avg_finish_hours","time_reliability"]:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

if "feedback_affidability" not in df.columns:
    df["feedback_affidability"] = 0.80
else:
    df["feedback_affidability"] = df["feedback_affidability"].fillna(0.80)

if "race_id" not in df.columns:
    df["race_id"] = df["race"].str.lower().str.replace(r"[^a-z0-9]+","_",regex=True)

# Abbina GPX
gpx_map = {}
if GPX_DIR.exists():
    for f in GPX_DIR.glob("*.gpx"):
        gpx_map[f.stem.lower()] = str(f)

def find_gpx(gpx_id):
    if pd.isna(gpx_id): return None
    gid = str(gpx_id).strip()
    stem = Path(gid).stem if gid.endswith(".gpx") else gid
    return gpx_map.get(stem.lower()) or gpx_map.get(gid.lower().replace(" ","_"))

df["gpx_path"] = df["gpx_id"].apply(find_gpx)

def row_mode(row):
    if pd.notna(row.get("gpx_path")): return "gpx"
    if pd.notna(row.get("distance_km")) and pd.notna(row.get("elevation_m")): return "manual"
    return "tech_only"

df["calc_mode"] = df.apply(row_mode, axis=1)

n_gpx  = (df["calc_mode"]=="gpx").sum()
n_man  = (df["calc_mode"]=="manual").sum()
n_tech = (df["calc_mode"]=="tech_only").sum()
n_t    = df["avg_finish_hours"].notna().sum()

print(f"  🗺   GPX reali abbinati:    {n_gpx}")
print(f"  📋  Dati manuali (no GPX): {n_man}")
print(f"  ⚠️   Solo technicality:     {n_tech}  (escluse da WDI)")
print(f"  ⏱   Con dati tempi:        {n_t} / {len(df)}")

unmatched = df[(df["gpx_id"].notna()) & (df["gpx_path"].isna())]
if len(unmatched):
    print(f"\n  ℹ️   GPX_ID senza file ({len(unmatched)}):")
    for _, r in unmatched.iterrows():
        print(f"       • {r['race']:<40} → fallback: {r['calc_mode']}")

# ── Merge con attività hub (se presenti) ──────────────────────────────────
hub_path = DATA_DIR / "hub_activities.csv"
if hub_path.exists() and hub_path.stat().st_size > 100:
    try:
        df_hub = pd.read_csv(hub_path)
        existing_ids = set(df["race_id"].str.lower())
        df_hub_new = df_hub[~df_hub["race_id"].str.lower().isin(existing_ids)].copy()
        if len(df_hub_new) > 0:
            for col in df.columns:
                if col not in df_hub_new.columns:
                    df_hub_new[col] = None
            df = pd.concat([df, df_hub_new[df.columns]], ignore_index=True)
            print(f"  + {len(df_hub_new)} attività hub aggiunte al dataset")
        else:
            print(f"  ℹ️   Attività hub già presenti nel dataset — skip")
    except Exception as e:
        print(f"  ⚠️  Errore merge hub_activities: {e} — continuo senza")

DATA_DIR.mkdir(exist_ok=True)
df.to_csv(DATA_DIR / "prepared.csv", index=False)
print(f"\n  ✓  {len(df)} gare → data/prepared.csv")
