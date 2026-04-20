"""
Script 06 — Pubblica risultati calibrazione sull'hub
"""
import os, json, base64, sys
from pathlib import Path
import requests

VERCEL_HUB_URL  = os.environ.get("VERCEL_HUB_URL", "").rstrip("/")
ADMIN_TOKEN     = os.environ.get("HUB_ADMIN_TOKEN", "")
OUTPUT_DIR      = Path("output")
PLOTS_DIR       = OUTPUT_DIR / "plots"


def load_json(path):
    p = Path(path)
    return json.loads(p.read_text()) if p.exists() else {}


def load_base64(path):
    p = Path(path)
    return base64.b64encode(p.read_bytes()).decode() if p.exists() else None


def get_stats():
    try:
        import pandas as pd
        df      = pd.read_csv("data/computed.csv")
        n_total = len(df)
        n_gpx   = int((df.get("calc_source", "") == "gpx").sum()) if "calc_source" in df.columns else 0
    except Exception:
        n_total, n_gpx = 0, 0
    return {"n_races_total": n_total, "n_races_gpx": n_gpx}


def main():
    if not VERCEL_HUB_URL:
        print("  ⚠️  VERCEL_HUB_URL non configurato — skip")
        return
    if not ADMIN_TOKEN:
        print("  ⚠️  HUB_ADMIN_TOKEN non configurato — skip")
        return

    print(f"  Raccolta risultati calibrazione...")
    print(f"  VERCEL_HUB_URL: {VERCEL_HUB_URL}")
    print(f"  HUB_ADMIN_TOKEN (primi 8 chars): {ADMIN_TOKEN[:8]}...")

    wdi_cal = load_json(OUTPUT_DIR / "1_wdi_calibration.json")
    pacing  = load_json(OUTPUT_DIR / "2_pacing_coefficients.json")
    patch   = (OUTPUT_DIR / "4_wiztrail_patch.js").read_text() \
              if (OUTPUT_DIR / "4_wiztrail_patch.js").exists() else None
    plot    = load_base64(PLOTS_DIR / "history_rmse.png")
    stats   = get_stats()

    # Il token va sia nell'URL (query param) sia nel body
    # per compatibilità con checkAuth() che cerca in entrambi i posti
    url = f"{VERCEL_HUB_URL}/api/hub/patch?key={ADMIN_TOKEN}"

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
        r = requests.post(url, json=payload, timeout=30)
        print(f"  HTTP status: {r.status_code}")
        print(f"  Response: {r.text[:200]}")
        r.raise_for_status()
        result = r.json()
        print(f"  ✓ Risultati pubblicati — RMSE: {result.get('rmse', '?')}")
    except requests.exceptions.RequestException as e:
        print(f"  ❌ Errore push risultati: {e}")
        # Non blocca la pipeline
        sys.exit(0)


if __name__ == "__main__":
    main()
