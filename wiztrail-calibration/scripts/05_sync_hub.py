"""
Script 05 — Sincronizza attività dall'hub Redis
────────────────────────────────────────────────
Scarica le attività con status "pending" da Redis,
le converte in righe aggiuntive per il dataset,
e salva i GPX nella cartella gpx/.

Viene eseguito da GitHub Actions prima della pipeline principale.
Non modifica dataset.xlsx — le attività hub vengono iniettate
in data/hub_activities.csv, letto da 01_prepare_dataset.py
come fonte aggiuntiva opzionale.

Variabili d'ambiente richieste:
  UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN
"""

import os, json, base64
from pathlib import Path
import pandas as pd
import requests

UPSTASH_URL   = os.environ["UPSTASH_REDIS_REST_URL"]
UPSTASH_TOKEN = os.environ["UPSTASH_REDIS_REST_TOKEN"]

GPX_DIR  = Path("gpx")
DATA_DIR = Path("data")
GPX_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

TECH_LABEL_MAP = {
    "runnable":  2.5,
    "mixed":     5.0,
    "technical": 7.0,
    "alpine":    8.5,
    "extreme":   9.5,
}


# ── Upstash client ─────────────────────────────────────────────────────────────

def redis_get(key: str):
    r = requests.get(
        f"{UPSTASH_URL}/get/{requests.utils.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"},
        timeout=10,
    )
    r.raise_for_status()
    result = r.json().get("result")
    return json.loads(result) if result else None


def redis_keys(pattern: str) -> list:
    r = requests.get(
        f"{UPSTASH_URL}/keys/{requests.utils.quote(pattern, safe='')}",
        headers={"Authorization": f"Bearer {UPSTASH_TOKEN}"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("result") or []


def redis_set(key: str, value):
    r = requests.post(
        f"{UPSTASH_URL}/set/{requests.utils.quote(key, safe='')}",
        headers={
            "Authorization": f"Bearer {UPSTASH_TOKEN}",
            "Content-Type": "application/json",
        },
        json={"value": json.dumps(value)},
        timeout=10,
    )
    r.raise_for_status()


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("  Connessione a Redis...")
    keys = redis_keys("hub:activities:*")
    print(f"  Attività totali in Redis: {len(keys)}")

    pending = []
    for key in keys:
        activity = redis_get(key)
        if activity and activity.get("status") == "pending":
            pending.append(activity)

    print(f"  Attività pending da sincronizzare: {len(pending)}")

    if not pending:
        print("  Nessuna nuova attività — pipeline usa solo dataset esistente")
        # Crea file vuoto per segnalare che lo step è stato eseguito
        (DATA_DIR / "hub_activities.csv").write_text(
            "race_id,race,distance_km,elevation_m,technicality,technicality_explicit,"
            "feedback_affidability,avg_finish_hours,source\n"
        )
        return

    rows = []
    saved_gpx = 0

    for act in pending:
        # Salva GPX
        gpx_filename = act.get("gpx_filename", f"{act['id']}.gpx")
        if not gpx_filename.endswith(".gpx"):
            gpx_filename += ".gpx"

        gpx_path = GPX_DIR / gpx_filename
        if act.get("gpx_base64"):
            try:
                gpx_bytes = base64.b64decode(act["gpx_base64"])
                gpx_path.write_bytes(gpx_bytes)
                saved_gpx += 1
                print(f"  ✓ GPX salvato: {gpx_filename}")
            except Exception as e:
                print(f"  ⚠️  Errore GPX {gpx_filename}: {e}")
                gpx_path = None
        else:
            gpx_path = None

        # Converti in riga dataset
        race_id = gpx_filename.replace(".gpx", "").replace(" ", "_").lower()
        tech = float(act.get("technicality", TECH_LABEL_MAP.get(act.get("tech_label", "mixed"), 5.0)))

        rows.append({
            "race_id":               race_id,
            "race":                  act.get("name", race_id),
            "distance_km":           act.get("km"),
            "elevation_m":           act.get("dplus"),
            "technicality":          tech,
            "technicality_explicit": act.get("tech_label", "mixed"),
            "feedback_affidability": 0.75,   # affidabilità conservativa per dati hub
            "avg_finish_hours":      act.get("time_hours"),
            "gpx_id":                gpx_filename.replace(".gpx", "") if gpx_path else None,
            "source":                "hub",
            "alias":                 act.get("alias", ""),
            "comment":               act.get("comment", ""),
        })

    # Salva CSV hub activities
    df = pd.DataFrame(rows)
    out_path = DATA_DIR / "hub_activities.csv"
    df.to_csv(out_path, index=False)

    print(f"\n  ✓ {len(rows)} attività hub → data/hub_activities.csv")
    print(f"  ✓ {saved_gpx} GPX salvati in gpx/")
    print(f"\n  Anteprima:")
    print(df[["race", "distance_km", "elevation_m", "technicality", "avg_finish_hours"]].to_string())


if __name__ == "__main__":
    main()
