"""
Script 07 — Applica la calibrazione a wiztrail-engine.js e wiztrail-timing.js
Legge output/1_wdi_calibration.json e output/2_timing_calibration.json
e sovrascrive i valori nei file JS nella root del repository.

Deve essere eseguito dalla directory wiztrail-calibration/.
"""
import json, re, sys
from pathlib import Path
from datetime import datetime

OUTPUT_DIR = Path("output")
ENGINE_JS  = Path("../wiztrail-engine.js")
TIMING_JS  = Path("../wiztrail-timing.js")


def load_json(path):
    p = Path(path)
    return json.loads(p.read_text()) if p.exists() else {}


def patch_engine(wdi_cal):
    """Aggiorna buildTechScore() in wiztrail-engine.js con i valori calibrati."""
    nr = wdi_cal.get("norm_refs", {})
    tw = wdi_cal.get("tech_score_weights", {})

    required_nr = ("frip", "slope_var", "roughness", "vert")
    required_tw = ("w_frip", "w_svar", "w_rough", "w_vert", "shape_w")

    if not nr or not tw:
        print("  [07] SKIP engine — norm_refs o tech_score_weights mancanti")
        return False
    if not all(k in nr for k in required_nr) or not all(k in tw for k in required_tw):
        print("  [07] SKIP engine — chiavi mancanti nel JSON di calibrazione")
        return False

    content = ENGINE_JS.read_text()
    original = content

    def sub(pattern, value, text):
        return re.sub(pattern, lambda m: m.group(1) + str(value) + m.group(2), text)

    # 4 divisori nelle clamp()
    content = sub(
        r'(clamp\(frip\s*/\s*)[\d.]+(\s*,\s*0\s*,\s*1\))',
        nr["frip"], content)
    content = sub(
        r'(clamp\(slopeVar\s*/\s*)[\d.]+(\s*,\s*0\s*,\s*1\))',
        nr["slope_var"], content)
    content = sub(
        r'(clamp\(roughness\s*/\s*)[\d.]+(\s*,\s*0\s*,\s*1\))',
        nr["roughness"], content)
    content = sub(
        r'(clamp\(\(gain\s*/\s*km\)\s*/\s*)[\d.]+(\s*,\s*0\s*,\s*1\))',
        nr["vert"], content)

    # 5 pesi nella formula raw = (...)
    # Esempio target:
    #   const raw = (normFRIP * 0.244 + normSVar * 0.421 + normRough * 0.208) * 0.873
    #             + vertInt * 0.127;
    raw_pat = (
        r'(const raw\s*=\s*\(normFRIP\s*\*\s*)' r'[\d.]+'
        r'(\s*\+\s*normSVar\s*\*\s*)'            r'[\d.]+'
        r'(\s*\+\s*normRough\s*\*\s*)'           r'[\d.]+'
        r'(\s*\)\s*\*\s*)'                        r'[\d.]+'
        r'(\s*\n\s*\+\s*vertInt\s*\*\s*)'        r'[\d.]+'
        r'(;)'
    )

    def raw_repl(m):
        return (
            f"{m.group(1)}{tw['w_frip']}"
            f"{m.group(2)}{tw['w_svar']}"
            f"{m.group(3)}{tw['w_rough']}"
            f"{m.group(4)}{tw['shape_w']}"
            f"{m.group(5)}{tw['w_vert']}"
            f"{m.group(6)}"
        )

    content = re.sub(raw_pat, raw_repl, content)

    if content == original:
        print("  [07] WARN: wiztrail-engine.js — pattern non trovati o valori già identici")
        return False

    ENGINE_JS.write_text(content)
    rmse_b = wdi_cal.get("rmse_before", "?")
    rmse_a = wdi_cal.get("rmse_after",  "?")
    impr   = wdi_cal.get("improvement_pct", "?")
    impr_s = f"{impr:+.1f}%" if isinstance(impr, float) else "?"
    print(f"  [07] ✓  wiztrail-engine.js aggiornato  RMSE {rmse_b} → {rmse_a} ({impr_s})")
    return True


def patch_timing(timing_cal):
    """Aggiorna VELOCITY_PARAMS in wiztrail-timing.js con i valori calibrati."""
    vp = timing_cal.get("velocity_params", {})
    if not vp:
        print("  [07] SKIP timing — velocity_params non disponibili")
        return False

    content = TIMING_JS.read_text()
    original = content

    for key in ["k_base", "k_spread", "cap_base", "cap_spread",
                "boost_base", "boost_S", "fatigue_coeff"]:
        if key not in vp:
            continue
        val = vp[key]
        pattern = rf'({re.escape(key)}:\s*)[\d.]+(\s*,)'
        content = re.sub(
            pattern,
            lambda m, v=val: f"{m.group(1)}{v}{m.group(2)}",
            content
        )

    if content == original:
        print("  [07] WARN: wiztrail-timing.js — pattern non trovati o valori già identici")
        return False

    TIMING_JS.write_text(content)
    rmse_a = timing_cal.get("rmse_after",  "?")
    n_r    = timing_cal.get("n_races_gpx", "?")
    print(f"  [07] ✓  wiztrail-timing.js aggiornato  RMSE {rmse_a}h  n_gare={n_r}")
    return True


def main():
    wdi_cal    = load_json(OUTPUT_DIR / "1_wdi_calibration.json")
    timing_cal = load_json(OUTPUT_DIR / "2_timing_calibration.json")

    ok_engine = patch_engine(wdi_cal)
    ok_timing = patch_timing(timing_cal)

    if not ok_engine and not ok_timing:
        print("  [07] Nessun file modificato — dati di calibrazione insufficienti.")
        sys.exit(0)

    print(f"  [07] Completato — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("  [07] Verifica il diff prima del merge del branch model-update.")


if __name__ == "__main__":
    main()
