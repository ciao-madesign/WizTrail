"""
Script 06 — Pubblica risultati calibrazione sull'hub
"""
import os, json, base64, sys
from pathlib import Path
import requests

VERCEL_HUB_URL    = os.environ.get("VERCEL_HUB_URL", "").rstrip("/")
ADMIN_TOKEN       = os.environ.get("HUB_ADMIN_TOKEN", "")
BYPASS_SECRET     = os.environ.get("VERCEL_BYPASS_SECRET", "")
OUTPUT_DIR        = Path("output")
PLOTS_DIR         = OUTPUT_DIR / "plots"


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

    wdi_cal = load_json(OUTPUT_DIR / "1_wdi_calibration.json")
    timing  = load_json(OUTPUT_DIR / "2_timing_calibration.json")
    patch   = (OUTPUT_DIR / "4_wiztrail_patch.js").read_text() \
              if (OUTPUT_DIR / "4_wiztrail_patch.js").exists() else None
    # Carica tutti i grafici disponibili
    plots = {}
    for name in ["history_rmse", "wdi_scatter", "timing_scatter",
                 "insights_distribution", "insights_tech_vs_wdi", "insights_spread"]:
        b64 = load_base64(PLOTS_DIR / f"{name}.png")
        if b64:
            plots[name] = b64
            print(f"  Grafico caricato: {name}.png")

    # Carica report markdown
    report_md = None
    report_path = OUTPUT_DIR / "3_insights_report.md"
    if report_path.exists():
        report_md = report_path.read_text()

    stats = get_stats()

    url = f"{VERCEL_HUB_URL}/api/hub?action=patch&key={ADMIN_TOKEN}"

    headers = {"Content-Type": "application/json"}
    if BYPASS_SECRET:
        headers["x-vercel-protection-bypass"] = BYPASS_SECRET

    payload = {
        "key":              ADMIN_TOKEN,
        "wdi_calibration":  wdi_cal,
        "timing":           timing,
        "stats":            stats,
        "plots":            plots,
        "plot_rmse_base64": plots.get("history_rmse"),
        "report_md":        report_md,
        "patch_js":         patch,
    }

    print(f"  Invio a {VERCEL_HUB_URL}/api/hub?action=patch ...")
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=30)
        print(f"  HTTP status: {r.status_code}")
        r.raise_for_status()
        result = r.json()
        print(f"  ✓ Risultati pubblicati — RMSE: {result.get('rmse', '?')}")
    except requests.exceptions.RequestException as e:
        print(f"  ❌ Errore push risultati: {e}")
        sys.exit(0)


if __name__ == "__main__":
    main()
