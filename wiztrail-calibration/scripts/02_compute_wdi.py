"""
Script 02 — Calcola WDI su ogni gara del dataset
Replica esatta di wiztrail-engine.js v5.1.
GPX: usa solo punti con quota valida; ignora salti >300m (dati corrotti).
Manual: usa distance_km + elevation_m + technicality dal dataset.
"""
import json, math, warnings
import numpy as np
import pandas as pd
import gpxpy
from pathlib import Path

warnings.filterwarnings("ignore")
DATA_DIR   = Path("data")
OUTPUT_DIR = Path("output")

kT    = 0.50                   # calibrato 20/04/2026 — sincronizzato con wiztrail-engine.js v5.1
REF42 = math.pow(42, 0.48)    # era 0.55 — esponente ridotto per le ultra
SURFACE_MULT = {1:0.92,2:0.97,3:1.00,4:1.04,5:1.08}
TERRAIN_DEFAULTS = {           # sincronizzati con wiztrail-engine.js TERRAIN_DEFAULTS v2
    "E":  {"frip":0.22,"slope_var":0.38,"roughness":0.18},
    "EE": {"frip":0.38,"slope_var":0.55,"roughness":0.28},
    "EA": {"frip":0.55,"slope_var":0.70,"roughness":0.40},
}

# Valori di default v1.0 (fallback se nessuna calibrazione precedente disponibile)
_TECH_DEFAULTS = {
    "nf_r":0.924,"ns_r":0.180,"nr_r":0.500,"nv_r":74.1,
    "w_frip":0.244,"w_svar":0.421,"w_rough":0.208,"w_vert":0.127,"shape_w":0.873,
}

def _load_tech_params():
    """Carica norm_refs e pesi TechScore dall'ultima calibrazione, o usa i default v1.0."""
    try:
        cal = json.loads((OUTPUT_DIR/"1_wdi_calibration.json").read_text())
        refs = cal.get("norm_refs",{}); wts = cal.get("tech_score_weights",{})
        if refs and wts and all(k in refs for k in ("frip","slope_var","roughness","vert")) \
                        and all(k in wts  for k in ("w_frip","w_svar","w_rough","w_vert","shape_w")):
            print("  [02] Bootstrap TechScore da output/1_wdi_calibration.json")
            return {
                "nf_r":refs["frip"],"ns_r":refs["slope_var"],
                "nr_r":refs["roughness"],"nv_r":refs["vert"],
                "w_frip":wts["w_frip"],"w_svar":wts["w_svar"],
                "w_rough":wts["w_rough"],"w_vert":wts["w_vert"],"shape_w":wts["shape_w"],
            }
    except Exception:
        pass
    return dict(_TECH_DEFAULTS)

TECH_PARAMS = _load_tech_params()

def tech_to_terrain(t):
    if t<=3.0: return "E"
    if t<=6.5: return "EE"
    return "EA"

def clamp(x,a,b): return max(a,min(b,x))

def build_tech_score(frip,slope_var,roughness,gain,km,surf=3):
    p = TECH_PARAMS
    nf = clamp(frip/p["nf_r"],  0,1); ns = clamp(slope_var/p["ns_r"], 0,1)
    nr = clamp(roughness/p["nr_r"],0,1); nv = clamp((gain/max(km,0.1))/p["nv_r"],0,1)
    raw = (nf*p["w_frip"]+ns*p["w_svar"]+nr*p["w_rough"])*p["shape_w"] \
        + nv*p["w_vert"]*(1-p["shape_w"])
    return round(raw*100*(SURFACE_MULT.get(surf,1.0)),1)

def build_volume_score(gain,loss):
    dk=gain/1000; dl=loss/1000
    return (dk*10)/(1+math.sqrt(max(dk,1e-6))/8)+(dl*4)/(1+math.sqrt(max(dl,1e-6))/6)

def build_dist_factor(km):
    # esponente 0.48 (era 0.55) — sincronizzato con wiztrail-engine.js buildDistFactor()
    if km<=100: return math.pow(km,0.48)/REF42
    b=math.pow(100,0.48)/REF42; r=math.pow(100,0.42)
    return b+(math.pow(km,0.42)-r)/REF42*0.6

def build_alt_factor(alt): return 1+clamp((alt-1300)/10000,0,0.15)

def compute_wdi(ts,vs,df_,af): return round((vs+ts*kT)*df_*af,1)

def parse_gpx(path):
    try:
        with open(path) as f: gpx=gpxpy.parse(f)
    except: return None

    # Estrai solo punti con quota valida
    pts=[]
    for t in gpx.tracks:
        for s in t.segments:
            for p in s.points:
                if p.latitude and p.longitude and p.elevation is not None:
                    pts.append((p.latitude,p.longitude,float(p.elevation)))
    # Fallback: leggi anche routes se tracks è vuoto
    if not pts:
        for r in gpx.routes:
            for p in r.points:
                if p.latitude and p.longitude and p.elevation is not None:
                    pts.append((p.latitude,p.longitude,float(p.elevation)))

    if len(pts)<10: return None

    lats=np.array([p[0] for p in pts])
    lons=np.array([p[1] for p in pts])
    eles=np.array([p[2] for p in pts])

    # Filtra quote anomale (outlier >5000m o <-500m)
    valid=(eles>-500)&(eles<6000)
    if valid.sum()<10: return None
    lats,lons,eles=lats[valid],lons[valid],eles[valid]

    def hav(la1,lo1,la2,lo2):
        R=6371000.
        p1,p2=math.radians(la1),math.radians(la2)
        dp=math.radians(la2-la1); dl=math.radians(lo2-lo1)
        a=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return R*2*math.atan2(math.sqrt(a),math.sqrt(1-a))

    dists=[0.]
    for i in range(1,len(pts)):
        dists.append(dists[-1]+hav(lats[i-1],lons[i-1],lats[i],lons[i]))
    d=np.array(dists); km=d[-1]/1000.

    # Filtra salti quota anomali (>300m tra punti adiacenti = dato corrotto)
    ele_diffs=np.diff(eles)
    mask=np.abs(ele_diffs)<300
    gain=float(np.sum(ele_diffs[(ele_diffs>0)&mask]))
    loss=float(np.abs(np.sum(ele_diffs[(ele_diffs<0)&mask])))
    alt_media=float(np.mean(eles))

    slopes=[]
    for i in range(1,len(d)):
        dd=d[i]-d[i-1]
        if dd>0: slopes.append((eles[i]-eles[i-1])/dd)
    slopes=np.array(slopes) if slopes else np.array([0.])

    frip=0.
    for i in range(len(d)):
        j=i
        while j<len(d) and d[j]<d[i]+40: j+=1
        if j>=len(d): break
        s=abs((eles[j]-eles[i])/max(1,d[j]-d[i]))
        if s>frip: frip=s

    abs_s=np.abs(slopes); mean_s=float(np.mean(abs_s))
    sv=math.sqrt(float(np.var(slopes)))/(1+mean_s) if len(slopes)>1 else 0.
    rough=float(np.mean(np.abs(np.diff(slopes)))) if len(slopes)>1 else 0.

    return {"km":round(km,2),"gain":round(gain,0),"loss":round(loss,0),
            "alt_media":round(alt_media,0),
            "frip":round(frip,4),"slope_var":round(sv,4),"roughness":round(rough,4),
            "source":"gpx"}

def compute_row(row):
    tech=float(row["technicality"])
    mode=row.get("calc_mode","manual")

    # Inizializza variabili con valori di default per evitare UnboundLocalError
    km=gain=loss=frip=sv=rough=0.
    alt=800.; source="manual"

    if mode=="gpx":
        g=parse_gpx(str(row["gpx_path"]))
        if g:
            km,gain,loss,alt=g["km"],g["gain"],g["loss"],g["alt_media"]
            frip,sv,rough=g["frip"],g["slope_var"],g["roughness"]
            source="gpx"
        else:
            mode="manual"  # fallback

    if mode=="manual":
        km=float(row["distance_km"]); gain=float(row["elevation_m"]); loss=gain
        terrain=tech_to_terrain(tech); d=TERRAIN_DEFAULTS[terrain]
        frip,sv,rough=d["frip"],d["slope_var"],d["roughness"]
        alt=800.; source="manual"

    if mode=="tech_only":
        return {"wdi_computed":np.nan,"tech_computed":np.nan,
                "gpx_km":np.nan,"gpx_gain":np.nan,"gpx_loss":np.nan,
                "gpx_frip":np.nan,"gpx_slope_var":np.nan,"gpx_roughness":np.nan,
                "calc_source":"tech_only"}

    ts=build_tech_score(frip,sv,rough,gain,km)
    vs=build_volume_score(gain,loss)
    df_=build_dist_factor(km)
    af=build_alt_factor(alt)
    wdi=compute_wdi(ts,vs,df_,af)

    return {"wdi_computed":wdi,"tech_computed":ts,
            "volume_score":round(vs,2),"dist_factor":round(df_,3),
            "alt_factor":round(af,3),
            "gpx_km":round(km,1),"gpx_gain":round(gain,0),"gpx_loss":round(loss,0),
            "gpx_frip":round(frip,4),"gpx_slope_var":round(sv,4),
            "gpx_roughness":round(rough,4),"calc_source":source}

def main():
    df=pd.read_csv(DATA_DIR/"prepared.csv")
    print(f"  Gare: {len(df)}")
    results=[]
    for _,row in df.iterrows():
        r=compute_row(row)
        results.append(r)
        src="📍 GPX" if r["calc_source"]=="gpx" else ("📋 man" if r["calc_source"]=="manual" else "⚪ skip")
        wdi=f"{r['wdi_computed']:6.1f}" if r['wdi_computed']==r['wdi_computed'] else "   n/a"
        ts =f"{r['tech_computed']:5.1f}" if r['tech_computed']==r['tech_computed'] else "  n/a"
        print(f"  {src}  {row['race'][:42]:<42}  WDI={wdi}  Tech={ts}")

    df_res=pd.DataFrame(results)
    df_out=pd.concat([df.reset_index(drop=True),df_res],axis=1)
    df_out.to_csv(DATA_DIR/"computed.csv",index=False)

    n_g=(df_res["calc_source"]=="gpx").sum()
    n_m=(df_res["calc_source"]=="manual").sum()
    print(f"\n  ✓  GPX reale: {n_g}  |  Manuale: {n_m}  |  Dataset → data/computed.csv")
    valid=df_res["wdi_computed"].dropna()
    print(f"  WDI medio: {valid.mean():.1f}  |  range: {valid.min():.1f}–{valid.max():.1f}")

if __name__=="__main__":
    main()
