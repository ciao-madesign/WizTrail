"""
Script 06 — Pubblica risultati calibrazione sull'hub
─────────────────────────────────────────────────────
Eseguito da GitHub Actions al termine della pipeline.

1. Legge output/1_wdi_calibration.json e 2_pacing_coefficients.json
2. Legge il grafico output/plots/history_rmse.png e lo converte in base64
3. Legge output/4_wiztrail_patch.js
4. Chiama POST /api/hub/patch con tutti i dati
5. Il branch model-update viene creato da GitHub Actions (non da questo script)

Variabili d'ambiente richieste:
  UPSTASH_REDIS_REST_URL    (non usato direttamente — la API gestisce Redis)
  HUB_ADMIN_TOKEN           token admin per autenticarsi alla API
  VERCEL_HUB_URL            es. "https://wiztrail.app"
"""

import os, json, base64, sys
from pathlib import Path
import requests

VERCEL_HUB_URL  = os.environ.get("VERCEL_HUB_URL", "").rstrip("/")
ADMIN_TOKEN     = os.environ.get("HUB_ADMIN_TOKEN", "")
OUTPUT_DIR      = Path("output")
PLOTS_DIR       = OUTPUT_DIR / "plots"


def load_json(path: Path) -> dict:
    if not path.exists():
        print(f"  ⚠️  {path} non trovato — ignorato")
        return {}
    return json.loads(path.read_text())


def load_base64(path: Path) -> str | None:
    if not path.exists():
        return None
    return base64.b64encode(path.read_bytes()).decode()


def get_stats() -> dict:
    """Legge le statistiche del run corrente dal dataset."""
    try:
        import pandas as pd
        df = pd.read_csv("data/computed.csv")
        n_total = len(df)
        n_gpx   = int((df.get("calc_source", "") == "gpx").sum()) if "calc_source" in df.columns else 0
    except Exception:
        n_total, n_gpx = 0, 0
    return {"n_races_total": n_total, "n_races_gpx": n_gpx}


def main():
    if not VERCEL_HUB_URL:
        print("  ⚠️  VERCEL_HUB_URL non configurato — skip push risultati")
        return
    if not ADMIN_TOKEN:
        print("  ⚠️  HUB_ADMIN_TOKEN non configurato — skip push risultati")
        return

    print("  Raccolta risultati calibrazione...")

    wdi_cal = load_json(OUTPUT_DIR / "1_wdi_calibration.json")
    pacing  = load_json(OUTPUT_DIR / "2_pacing_coefficients.json")
    patch   = (OUTPUT_DIR / "4_wiztrail_patch.js").read_text() if (OUTPUT_DIR / "4_wiztrail_patch.js").exists() else None
    plot    = load_base64(PLOTS_DIR / "history_rmse.png")
    stats   = get_stats()

    payload = {
        "key":              ADMIN_TOKEN,
        "wdi_calibration":  wdi_cal,
        "pacing":           pacing,
        "stats":            stats,
        "plot_rmse_base64": plot,
        "patch_js":         patch,
    }

    print(f"  Invio a {VERCEL_HUB_URL}/api/hub/patch ...")
    try:
        r = requests.post(
            f"{VERCEL_HUB_URL}/api/hub/patch",
            json=payload,
            timeout=30,
        )
        r.raise_for_status()
        result = r.json()
        rmse   = result.get("rmse", "?")
        print(f"  ✓ Risultati pubblicati — RMSE aggiornato: {rmse}")
    except requests.exceptions.RequestException as e:
        print(f"  ❌ Errore push risultati: {e}")
        # Non blocca la pipeline — il branch viene creato comunque
        sys.exit(0)


if __name__ == "__main__":
    main()
