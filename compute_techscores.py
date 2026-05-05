#!/usr/bin/env python3
"""
Compute TechScore for all races in ranking-data.json.
Mirrors wiztrail-engine.js v5.1 exactly.
TechScore output: 0-100 scale (displayed as /10 in UI by dividing by 10).
"""

import json, math, os, sys
import urllib.request

CALIB_DIR  = "wiztrail-calibration/gpx"
VERCEL_BASE = "https://wiz-trail-np675drbu-ciao-madesigns-projects.vercel.app"

try:
    import gpxpy
except ImportError:
    os.system("pip install gpxpy -q")
    import gpxpy


# ── Calibration GPX mapping ──────────────────────────────────────────────────
CALIB_MAP = {
    "gpx/cdf_12k.gpx":              "12k CFT 2026_280126.gpx",
    "gpx/cdf_28.gpx":               "28K CFT 2026_280126.gpx",
    "gpx/cdf_38k.gpx":              "38k CFT 2026_280126..gpx",
    "gpx/cdf_50k.gpx":              "50k 2500m CFT2025 def.gpx",
    "gpx/cdf_70k.gpx":              "70K CFT 2026_280126.gpx",
    "gpx/black_canyon_100.gpx":     "black-canyon-ultras-2026-100k.gpx",
    "gpx/but.gpx":                  "BUT_2025.gpx",
    "gpx/lut_cortina_skyrace.gpx":  "cortina-skyrace.gpx",
    "gpx/dolomiti_brenta_trail.gpx":"dolomiti-di-brenta-trail-2025-45-km.gpx",
    "gpx/lut_20.gpx":               "LUT_20k_variante_2024_de2a531f04.gpx",
    "gpx/ortles_hr_35.gpx":         "ortles-35km-201659948.gpx",
    "gpx/ortles_hr_trail.gpx":      "ortles-route-v120126-1938739438.gpx",
    "gpx/sella_ronda_trail.gpx":    "sellaronda-trail-run-antiorario-da-canazei.gpx",
    "gpx/dolomyths_skyrun.gpx":     "Dolomyths skyrun.gpx",
    "gpx/tor30.gpx":                "TOR30-CERT-2025.gpx",
    "gpx/tor100.gpx":               "TOR100-CERT-2025.gpx",
    "gpx/tor130_totdret.gpx":       "TOR130-CERT-2025.gpx",
    "gpx/tor330.gpx":               "TOR330-CERT-2025.gpx",
    "gpx/transpelmo_skyrace.gpx":   "transpelmo_skyrace_2022.gpx",
    "gpx/utlac_60.gpx":             "utlac-60.gpx",
    "gpx/valtellina_wine_trail.gpx":"WINE TRAIL 42_2024.gpx",
}


# ── v5.1 engine — exact port from wiztrail-engine.js ────────────────────────

def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    φ1 = math.radians(lat1);  φ2 = math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lon2 - lon1)
    a  = math.sin(Δφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(Δλ/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def parse_gpx_de(gpx_text):
    """
    Return (d, e) arrays in meters:
      d[i] = cumulative distance from start (meters)
      e[i] = elevation (meters)
    Mirrors how gpx-parser.js builds metrics.d and metrics.e.
    """
    gpx = gpxpy.parse(gpx_text)
    raw = []
    for track in gpx.tracks:
        for seg in track.segments:
            for p in seg.points:
                raw.append((p.latitude, p.longitude, p.elevation or 0.0))
    if not raw:
        for rte in gpx.routes:
            for p in rte.points:
                raw.append((p.latitude, p.longitude, p.elevation or 0.0))
    if not raw:
        return [], []

    d = [0.0]
    e = [raw[0][2]]
    for i in range(1, len(raw)):
        dist = haversine_m(raw[i-1][0], raw[i-1][1], raw[i][0], raw[i][1])
        d.append(d[-1] + dist)
        e.append(raw[i][2])
    return d, e


def compute_slopes(d, e):
    """slopes[i] = (e[i+1]-e[i]) / (d[i+1]-d[i])  — ratio (not percent)."""
    slopes = []
    for i in range(1, len(d)):
        dd = d[i] - d[i-1]
        if dd > 0:
            slopes.append((e[i] - e[i-1]) / dd)
    return slopes


def compute_frip(d, e):
    """
    Max slope (ratio) observed over any 40-meter window.
    Mirrors JS computeFRIP(d, e) — sliding window, d in meters.
    """
    max_slope = 0.0
    n = len(d)
    j = 0
    for i in range(n):
        # advance j until d[j] >= d[i] + 40
        while j < n and d[j] < d[i] + 40:
            j += 1
        if j >= n:
            break
        seg_d = max(1.0, d[j] - d[i])
        slope = abs((e[j] - e[i]) / seg_d)
        if slope > max_slope:
            max_slope = slope
    return max_slope


def compute_slope_var(slopes):
    """Mirrors JS computeSlopeVar: σ(slopes) / (1 + mean(|slopes|))."""
    if not slopes:
        return 0.0
    abs_s  = [abs(s) for s in slopes]
    mean   = sum(abs_s) / len(abs_s)
    var    = sum((s - mean)**2 for s in slopes) / len(slopes)
    return math.sqrt(var) / (1 + mean)


def compute_roughness(slopes):
    """Mirrors JS computeRoughness: mean(|Δslope|)."""
    if len(slopes) < 2:
        return 0.0
    return sum(abs(slopes[i] - slopes[i-1]) for i in range(1, len(slopes))) / len(slopes)


def compute_gain(e):
    """Total positive elevation gain in meters."""
    gain = 0.0
    for i in range(1, len(e)):
        if e[i] > e[i-1]:
            gain += e[i] - e[i-1]
    return gain


def clamp(x, a, b):
    return max(a, min(b, x))


def build_tech_score(frip, slope_var, roughness, gain, km, surface_level=3):
    """
    Exact port of buildTechScore() from wiztrail-engine.js v5.1.
    Returns TechScore on 0-100 scale.
    """
    SURFACE_MULT = {1: 0.92, 2: 0.97, 3: 1.00, 4: 1.04, 5: 1.08}
    norm_frip  = clamp(frip      / 0.924, 0, 1)
    norm_svar  = clamp(slope_var / 0.180, 0, 1)
    norm_rough = clamp(roughness / 0.500, 0, 1)
    vert_int   = clamp((gain / km) / 74.1, 0, 1)  # gain in m, km in km → m/km / 74.1
    raw = (norm_frip * 0.244 + norm_svar * 0.421 + norm_rough * 0.208) * 0.873 + vert_int * 0.127
    mult = SURFACE_MULT.get(surface_level, 1.00)
    return round(raw * 100 * mult * 10) / 10


def tech_score_from_gpx(gpx_text, known_km=None, known_gain=None):
    """Compute TechScore from GPX text string."""
    d, e = parse_gpx_de(gpx_text)
    if len(d) < 3:
        return None
    slopes    = compute_slopes(d, e)
    frip      = compute_frip(d, e)
    slope_var = compute_slope_var(slopes)
    roughness = compute_roughness(slopes)
    km        = known_km  if known_km  else d[-1] / 1000
    gain      = known_gain if known_gain else compute_gain(e)
    return build_tech_score(frip, slope_var, roughness, gain, km)


# ── GPX loading ──────────────────────────────────────────────────────────────

def load_calib(filename):
    path = os.path.join(CALIB_DIR, filename)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def fetch_vercel(gpx_path):
    url = f"{VERCEL_BASE}/{gpx_path}"
    print(f"    fetch {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "WizTrail/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 200:
                return resp.read().decode("utf-8", errors="replace")
    except Exception as ex:
        print(f"    !! {ex}")
    return None


def extract_terrain_params(gpx_text):
    """Return (frip, slopeVar, roughness) from a GPX file for use as terrain proxy."""
    d, e = parse_gpx_de(gpx_text)
    if len(d) < 3:
        return None
    slopes    = compute_slopes(d, e)
    frip      = compute_frip(d, e)
    slope_var = compute_slope_var(slopes)
    roughness = compute_roughness(slopes)
    return frip, slope_var, roughness


# TERRAIN_DEFAULTS: used as proxy when no GPX is available.
# These match TERRAIN_DEFAULTS in wiztrail-engine.js (surfaceLevel=3).
TERRAIN_DEFAULTS = {
    'E':  (0.22, 0.38, 0.18),   # sentiero segnato, pendenze moderate
    'EE': (0.38, 0.55, 0.28),   # sentiero tecnico, pietraie
    'EA': (0.55, 0.70, 0.40),   # terreno alpinistico
}

# Proxy GPX for races without a direct match:
#   gpx_path → (calib_file, terrain_override)
# terrain_override is 'E'/'EE'/'EA' for pure-default fallback, or None to use proxy GPX.
PROXY_MAP = {
    # UTLAC 30 → UTLAC 60 (same race series, same terrain)
    "gpx/utlac_30.gpx":               ("utlac-60.gpx", None),
    # Lavaredo 80K → Lavaredo 50K (same region, same terrain profile)
    "gpx/lavaredo_80k.gpx":           ("Lavaredo50_K_6b9b57cbde.gpx", None),
    # Others: use TERRAIN_DEFAULTS EE (alpine/competitive trails)
    "gpx/orsa_pravello_trincea_trail.gpx": (None, 'EE'),
    "gpx/vut90.gpx":                  (None, 'EE'),
    "gpx/vut35.gpx":                  (None, 'EE'),
    "gpx/bettelmatt_race.gpx":        (None, 'E'),
    "gpx/lut_50.gpx":                 (None, 'EE'),
    "gpx/lut120.gpx":                 (None, 'EE'),
    "gpx/transvulcania_marathon.gpx": (None, 'EE'),
    "gpx/transvulcania_ultra.gpx":    (None, 'EE'),
}


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    with open("ranking-data.json") as f:
        races = json.load(f)

    ok = err = skip = 0

    for race in races:
        name     = race.get("name", "?")
        gpx_path = race.get("gpx")
        km       = race.get("distance")
        gain     = race.get("dplus")

        if not gpx_path:
            print(f"  SKIP (no gpx): {name}")
            skip += 1
            continue

        ts = None

        # 1. Try direct calibration mapping
        calib_file = CALIB_MAP.get(gpx_path)
        if calib_file:
            gpx_text = load_calib(calib_file)
            if gpx_text:
                print(f"  [CALIB] {name}")
                ts = tech_score_from_gpx(gpx_text, known_km=km, known_gain=gain)

        # 2. Proxy mapping (terrain params from similar GPX, known distance/gain)
        if ts is None and gpx_path in PROXY_MAP:
            proxy_file, terrain_type = PROXY_MAP[gpx_path]
            if proxy_file:
                gpx_text = load_calib(proxy_file)
                if gpx_text:
                    params = extract_terrain_params(gpx_text)
                    if params:
                        frip, slope_var, roughness = params
                        ts = build_tech_score(frip, slope_var, roughness, gain, km)
                        print(f"  [PROXY:{proxy_file}] {name}")
            if ts is None and terrain_type:
                frip, slope_var, roughness = TERRAIN_DEFAULTS[terrain_type]
                ts = build_tech_score(frip, slope_var, roughness, gain, km)
                print(f"  [DEFAULT:{terrain_type}] {name}")

        # 3. Fallback: fetch from Vercel
        if ts is None:
            gpx_text = fetch_vercel(gpx_path)
            if gpx_text:
                ts = tech_score_from_gpx(gpx_text, known_km=km, known_gain=gain)

        if ts is not None:
            race["techScore"] = ts
            print(f"    → {ts:5.1f}  {name}")
            ok += 1
        else:
            print(f"  !! No result: {name}")
            err += 1

    print(f"\n{'─'*50}")
    print(f"OK: {ok}  |  Errors: {err}  |  Skipped: {skip}  |  Total: {len(races)}")

    with open("ranking-data.json", "w") as f:
        json.dump(races, f, indent=2, ensure_ascii=False)
    print("ranking-data.json saved.")


if __name__ == "__main__":
    main()
