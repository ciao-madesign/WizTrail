"""
Script 03 — Calibrazione WDI + Modello Tempi a Segmenti (v3)
─────────────────────────────────────────────────────────────
Parte A: pesi buildTechScore() ottimizzati su GPX reali (invariata)
Parte B: calibrazione parametri wiztrail-timing.js (VELOCITY_PARAMS)
         Usa solo le gare con GPX reale (opzione A, nessun GPX sintetico).
         Replica Python del modello a segmenti di wiztrail-timing.js.
         Profili atleta fissi (S e velBase):
           top100_men:   S=0.85  velBase=15.0 km/h (4.0 min/km strada)
           avg_finish:   S=0.40  velBase=10.0 km/h (6.0 min/km strada)
           top100_women: S=0.80  velBase=12.0 km/h (5.0 min/km strada)
         Parametri calibrati (7):
           k_base, k_spread   → pendenza salita
           cap_base, cap_spread → tetto rallentamento
           boost_base, boost_S  → accelerazione discesa
           fatigue_coeff        → intensità fatica
         Output: output/2_timing_calibration.json
"""
import json, math, warnings
import numpy as np
import pandas as pd
import gpxpy
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.optimize import differential_evolution
from pathlib import Path

warnings.filterwarnings("ignore")
DATA_DIR=Path("data"); OUTPUT_DIR=Path("output"); PLOTS_DIR=OUTPUT_DIR/"plots"
GPX_DIR =Path("gpx")
OUTPUT_DIR.mkdir(exist_ok=True); PLOTS_DIR.mkdir(exist_ok=True)

kT=0.50; REF42=math.pow(42,0.48)  # sincronizzato con wiztrail-engine.js v5.1

def clamp(x,a,b): return max(a,min(b,x))
def enrich_df(df):
    df=df.copy()
    df["km_eff"]   = df["gpx_km"].fillna(df["distance_km"])
    df["gain_eff"] = df["gpx_gain"].fillna(df["elevation_m"])
    df["loss_eff"] = df["gpx_loss"].fillna(df["elevation_m"])
    return df

# ══════════════════════════════════════════════════════
#  PARTE A — TechScore
# ══════════════════════════════════════════════════════
def build_ts_param(frip,sv,rough,gain,km,nf_r,ns_r,nr_r,nv_r,wf,ws,wr,wv,shp):
    nf=clamp(frip/nf_r,0,1); ns=clamp(sv/ns_r,0,1)
    nr=clamp(rough/nr_r,0,1); nv=clamp((gain/max(km,0.1))/nv_r,0,1)
    raw=(wf*nf+ws*ns+wr*nr)*shp+wv*nv*(1-shp)
    return raw*100

def tech_obj(params,df,target,wcol):
    nf_r,ns_r,nr_r,nv_r,wf,ws,wr,wv,shp=params
    if any(p<=0 for p in [nf_r,ns_r,nr_r,nv_r,wf,ws,wr,wv]): return 1e9
    wt=wf+ws+wr+wv; wf/=wt; ws/=wt; wr/=wt; wv/=wt
    shp=clamp(shp,0.3,0.9)
    preds=df.apply(lambda r: build_ts_param(
        r["gpx_frip"],r["gpx_slope_var"],r["gpx_roughness"],
        r["gpx_gain"],r["gpx_km"],nf_r,ns_r,nr_r,nv_r,wf,ws,wr,wv,shp),axis=1).values
    return float(np.sqrt(np.average((preds-target)**2,weights=df[wcol].values)))

# ══════════════════════════════════════════════════════
#  PARTE B — Modello a segmenti (replica di wiztrail-timing.js)
# ══════════════════════════════════════════════════════

# Profili atleta fissi: (S, velBase km/h, colonna dataset, peso affidabilità)
ATHLETE_PROFILES = {
    "top100_men":   {"S":0.85, "vel_base":15.0, "time_col":"avg_top100_men_hours",   "weight":1.2},
    "avg_finish":   {"S":0.40, "vel_base":10.0, "time_col":"avg_finish_hours",        "weight":1.0},
    "top100_women": {"S":0.80, "vel_base":12.0, "time_col":"avg_top100_women_hours",  "weight":1.1},
}

TRAIL_BASE_FACTOR = {"Strada":1.00,"E":1.00,"EE":0.85,"EA":0.75}

def _hav(la1,lo1,la2,lo2):
    R=6371000.; t=math.pi/180
    dlat=(la2-la1)*t; dlon=(lo2-lo1)*t
    k=math.sin(dlat/2)**2+math.cos(la1*t)*math.cos(la2*t)*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(max(0,min(1,k))))

def _smooth(eles,w=2):
    out=[]
    for i in range(len(eles)):
        s,c=0,0
        for k in range(-w,w+1):
            idx=i+k
            if 0<=idx<len(eles): s+=eles[idx]; c+=1
        out.append(s/c if c>0 else eles[i])
    return out

def load_gpx_for_timing(gpx_path):
    """Carica GPX e restituisce (dists_m, eles_smooth) per il modello a segmenti."""
    try:
        with open(gpx_path) as f: gpx=gpxpy.parse(f)
    except: return None
    pts=[]
    for t in gpx.tracks:
        for s in t.segments:
            for p in s.points:
                if p.elevation is not None:
                    pts.append((p.latitude,p.longitude,float(p.elevation)))
    if not pts:
        for r in gpx.routes:
            for p in r.points:
                if p.elevation is not None:
                    pts.append((p.latitude,p.longitude,float(p.elevation)))
    if len(pts)<10: return None
    eles=[p[2] for p in pts]
    dists=[0.]
    for i in range(1,len(pts)):
        dists.append(dists[-1]+_hav(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1]))
    return dists, _smooth(eles)

def _vel_from_slope(p,S,vb,vp):
    if abs(p)<0.015: return vb
    if p>0:
        k  =vp[0]+vp[1]*(1-S)
        cap=vp[2]+vp[3]*(1-S)
        return vb/min(1+k*p,cap)
    boost=vp[4]+vp[5]*S
    if p<-0.25:
        steep=(1-S)*(abs(p)-0.25)*2
        return vb*max(boost-steep,0.85)
    return vb*boost

def segment_time(dists,eles_s,vel_base,S,vp):
    """Calcola tempo in secondi — specchio di WizTrailTiming.computeTime."""
    SEG=80.; T=0.; last_i=0
    fc=vp[6]
    for i in range(1,len(dists)):
        d=dists[i]-dists[last_i]
        if d>=SEG:
            dh=eles_s[i]-eles_s[last_i]
            slope=max(-0.35,min(0.35,dh/d))
            v=_vel_from_slope(slope,S,vel_base,vp)
            t_raw=d/(v*1000/3600)
            fat=min(1+fc*math.pow(T/3600/8,1.2), 2.5)  # cap FATIGUE_CAP=2.5
            T+=t_raw*fat; last_i=i
    return T

def timing_obj(params_arr,gpx_cache,df):
    k_base,k_spread,cap_base,cap_spread,boost_base,boost_S,fc=params_arr
    if k_base<=0 or k_spread<0 or cap_base<=1.0 or cap_spread<0: return 1e9
    if boost_base<1.0 or boost_S<0 or fc<0: return 1e9
    vp=(k_base,k_spread,cap_base,cap_spread,boost_base,boost_S,fc)
    errors=[]; weights=[]
    for _,row in df.iterrows():
        gid=str(row.get("gpx_id",""))
        if gid not in gpx_cache: continue
        dists,eles_s=gpx_cache[gid]
        for pk,prof in ATHLETE_PROFILES.items():
            col=prof["time_col"]
            real_h=row.get(col)
            if pd.isna(real_h): continue
            vb=prof["vel_base"]*TRAIL_BASE_FACTOR.get(str(row.get("terrain_class","E")),1.0)
            est_s=segment_time(dists,eles_s,vb,prof["S"],vp)
            errors.append(est_s/3600-real_h)
            weights.append(float(row.get("feedback_affidability",1.0))*prof["weight"])
    if len(errors)<5: return 1e9
    return float(np.sqrt(np.average(np.array(errors)**2,weights=np.array(weights))))

def _load_x0():
    """Costruisce x0 dall'ultima calibrazione (output/1_wdi_calibration.json).
    Fallback ai parametri calibrati v1.0 se il file non esiste o è incompleto.
    ordine: [nf_r, ns_r, nr_r, nv_r, w_frip, w_svar, w_rough, w_vert, shape_w]
    """
    _default = [0.924,0.180,0.500,74.1,0.244,0.421,0.208,0.127,0.873]
    try:
        cal = json.loads((OUTPUT_DIR/"1_wdi_calibration.json").read_text())
        refs = cal.get("norm_refs",{}); wts = cal.get("tech_score_weights",{})
        if refs and wts and all(k in refs for k in ("frip","slope_var","roughness","vert")) \
                        and all(k in wts  for k in ("w_frip","w_svar","w_rough","w_vert","shape_w")):
            print("  [A] Bootstrap x0 da output/1_wdi_calibration.json")
            return [refs["frip"],refs["slope_var"],refs["roughness"],refs["vert"],
                    wts["w_frip"],wts["w_svar"],wts["w_rough"],wts["w_vert"],wts["shape_w"]]
    except Exception:
        pass
    return _default

def main():
    df=pd.read_csv(DATA_DIR/"computed.csv"); df=enrich_df(df)
    print(f"  Gare totali: {len(df)}")

    # ── A ────────────────────────────────────────────────────────────────────
    df_gpx=df[df["calc_source"]=="gpx"].dropna(
        subset=["gpx_frip","gpx_slope_var","gpx_roughness","gpx_gain","gpx_km","technicality"])
    n=len(df_gpx); print(f"\n  [A] TechScore — {n} GPX")
    wdi_calib={}; xo=_load_x0()
    if n>=5:
        target=df_gpx["technicality"].values*10.
        bounds=[(0.20,1.50),(0.10,1.50),(0.05,1.50),(50,300),
                (0.05,0.80),(0.05,0.80),(0.05,0.60),(0.05,0.60),(0.30,0.90)]
        rb=tech_obj(xo,df_gpx,target,"feedback_affidability")
        res=differential_evolution(tech_obj,bounds,
            args=(df_gpx,target,"feedback_affidability"),
            seed=42,maxiter=500,tol=1e-9,workers=1,polish=True)
        xo=res.x; ra=res.fun
        wt=xo[4]+xo[5]+xo[6]+xo[7]
        wdi_calib={
            "tech_score_weights":{
                "w_frip":round(xo[4]/wt,3),"w_svar":round(xo[5]/wt,3),
                "w_rough":round(xo[6]/wt,3),"w_vert":round(xo[7]/wt,3),
                "shape_w":round(clamp(xo[8],0.3,0.9),3)},
            "norm_refs":{
                "frip":round(xo[0],3),"slope_var":round(xo[1],3),
                "roughness":round(xo[2],3),"vert":round(xo[3],1)},
            "rmse_before":round(rb,3),"rmse_after":round(ra,3),
            "improvement_pct":round((rb-ra)/rb*100,1),"n_races_gpx":n}
        print(f"     RMSE: {rb:.2f}→{ra:.2f}  ({wdi_calib['improvement_pct']:+.1f}%)")
        print(f"     Pesi norm: FRIP={xo[4]/wt:.3f}  SVar={xo[5]/wt:.3f}  Rough={xo[6]/wt:.3f}  Vert={xo[7]/wt:.3f}")
        print(f"     Refs: frip={xo[0]:.3f}  svar={xo[1]:.3f}  rough={xo[2]:.3f}  vert={xo[3]:.0f}m/km×1000")
    else:
        print(f"     ⚠️  Solo {n} GPX")
        wdi_calib={"note":f"Servono ≥5 GPX, disponibili {n}","n_races_gpx":n}

    # ── B ────────────────────────────────────────────────────────────────────
    # Calibrazione VELOCITY_PARAMS di wiztrail-timing.js
    # Usa solo gare con GPX reale (opzione A: nessun GPX sintetico).
    # Carica i file GPX una sola volta in cache, poi ottimizza i 7 parametri.
    df_gpx_t=df[df["calc_source"]=="gpx"].copy()
    print(f"\n  [B] Timing (segmenti) — carico GPX per {len(df_gpx_t)} gare")

    gpx_cache={}
    for _,row in df_gpx_t.iterrows():
        gid=str(row.get("gpx_id",""))
        if not gid: continue
        for ext in [".gpx",".GPX"]:
            p=GPX_DIR/f"{gid}{ext}"
            if p.exists():
                result=load_gpx_for_timing(p)
                if result: gpx_cache[gid]=result
                break
    n_gpx_loaded=len(gpx_cache)
    print(f"     GPX caricati: {n_gpx_loaded}")

    # Conta coppie (gara × profilo) con dati validi
    n_pairs=0
    for _,row in df_gpx_t.iterrows():
        if str(row.get("gpx_id","")) not in gpx_cache: continue
        for prof in ATHLETE_PROFILES.values():
            if not pd.isna(row.get(prof["time_col"])): n_pairs+=1
    print(f"     Coppie gara×profilo disponibili: {n_pairs}")

    timing_calib={"note":f"Solo {n_gpx_loaded} GPX caricati, {n_pairs} coppie","n_races_gpx":n_gpx_loaded}
    vp_default=(1.5,2.5,1.6,0.9,1.05,0.25,0.6)

    if n_pairs>=5:
        x0=list(vp_default)
        bounds=[(0.5,3.5),(0.5,5.0),(1.1,2.5),(0.2,2.0),(1.0,1.20),(0.0,0.60),(0.1,1.5)]
        rb=timing_obj(x0,gpx_cache,df_gpx_t)
        print(f"     RMSE iniziale (valori di default): {rb:.3f}h")
        res=differential_evolution(timing_obj,bounds,
            args=(gpx_cache,df_gpx_t),
            seed=42,maxiter=150,tol=1e-6,popsize=8,workers=1,polish=True)
        xo_t=res.x; ra=res.fun
        timing_calib={
            "velocity_params":{
                "k_base":      round(float(xo_t[0]),4),
                "k_spread":    round(float(xo_t[1]),4),
                "cap_base":    round(float(xo_t[2]),4),
                "cap_spread":  round(float(xo_t[3]),4),
                "boost_base":  round(float(xo_t[4]),4),
                "boost_S":     round(float(xo_t[5]),4),
                "fatigue_coeff":round(float(xo_t[6]),4),
            },
            "rmse_before":round(rb,3),"rmse_after":round(ra,3),
            "improvement_pct":round((rb-ra)/rb*100,1) if rb>0 else 0,
            "n_races_gpx":n_gpx_loaded,"n_pairs":n_pairs,
            "athlete_profiles":{pk:{"S":v["S"],"vel_base":v["vel_base"]}
                                 for pk,v in ATHLETE_PROFILES.items()},
        }
        print(f"     RMSE: {rb:.3f}h → {ra:.3f}h  ({timing_calib['improvement_pct']:+.1f}%)")
        print(f"     k_base={xo_t[0]:.3f}  k_spread={xo_t[1]:.3f}  "
              f"cap_base={xo_t[2]:.3f}  cap_spread={xo_t[3]:.3f}")
        print(f"     boost_base={xo_t[4]:.3f}  boost_S={xo_t[5]:.3f}  fatigue_coeff={xo_t[6]:.3f}")
        checks=_sanity_check_timing(df_gpx_t,gpx_cache,xo_t)
        timing_calib["sanity_checks"]=checks
        print("     Sanity check:")
        for race,prof,est,real in checks:
            diff=est-real; sign="↑" if diff>0 else "↓"
            print(f"       {race[:25]:<25} [{prof}]: stima={est:.2f}h  reale={real:.2f}h  {sign}{abs(diff):.2f}h")
    else:
        print(f"     ⚠️  Coppie insufficienti ({n_pairs}) — uso valori di default")

    _plot_wdi(df_gpx,xo,wdi_calib)
    _plot_timing(df_gpx_t,gpx_cache,timing_calib)

    (OUTPUT_DIR/"1_wdi_calibration.json").write_text(json.dumps(wdi_calib,indent=2,ensure_ascii=False))
    (OUTPUT_DIR/"2_timing_calibration.json").write_text(json.dumps(timing_calib,indent=2,ensure_ascii=False))
    print(f"\n  ✓  Output salvati in output/")

def _sanity_check_timing(df,gpx_cache,xo_t):
    """Sanity check su gare benchmark con GPX reale."""
    benchmarks=["UTMB","CCC","Zegama-Aizkorri","Western States 100","Sierre-Zinal",
                "Speedgoat 50K","Hardrock 100"]
    checks=[]
    vp=tuple(xo_t)
    for race in benchmarks:
        row=df[df["race"]==race]
        if row.empty: continue
        r=row.iloc[0]
        gid=str(r.get("gpx_id",""))
        if gid not in gpx_cache: continue
        dists,eles_s=gpx_cache[gid]
        for pk,prof in ATHLETE_PROFILES.items():
            col=prof["time_col"]
            real_h=r.get(col)
            if pd.isna(real_h): continue
            vb=prof["vel_base"]*TRAIL_BASE_FACTOR.get(str(r.get("terrain_class","E")),1.0)
            est_h=segment_time(dists,eles_s,vb,prof["S"],vp)/3600
            checks.append((race,pk,round(est_h,2),round(float(real_h),2)))
    return checks

def _plot_wdi(df_gpx,xo,cal):
    if df_gpx.empty: return
    wt=max(xo[4]+xo[5]+xo[6]+xo[7],1e-9)
    def ts_opt(r):
        shp=clamp(xo[8],0.3,0.9)
        nf=clamp(r["gpx_frip"]/xo[0],0,1); ns=clamp(r["gpx_slope_var"]/xo[1],0,1)
        nr=clamp(r["gpx_roughness"]/xo[2],0,1); nv=clamp((r["gpx_gain"]/max(r["gpx_km"],0.1))/xo[3],0,1)
        return ((xo[4]/wt)*nf+(xo[5]/wt)*ns+(xo[6]/wt)*nr)*shp+(xo[7]/wt)*nv*(1-shp)*100
    target=df_gpx["technicality"]*10; opt=df_gpx.apply(ts_opt,axis=1); curr=df_gpx["tech_computed"]
    fig,axes=plt.subplots(1,2,figsize=(13,5)); fig.patch.set_facecolor("#fafafa")
    for ax,vals,clr,ttl in zip(axes,[curr,opt],["#E8593C","#1D9E75"],["TechScore attuale","TechScore ottimizzato"]):
        ax.scatter(target,vals,c=clr,alpha=0.7,s=55,edgecolors="white",linewidths=0.4)
        ax.plot([0,100],[0,100],"k--",alpha=0.25,lw=1)
        if len(target)>1:
            r=np.corrcoef(target,vals)[0,1]
            ax.text(5,92,f"r = {r:.3f}",fontsize=11,color=clr,fontweight="bold")
        ax.set_xlabel("Technicality × 10 (ground truth)"); ax.set_ylabel("TechScore WizTrail")
        ax.set_title(ttl); ax.set_xlim([0,100]); ax.set_ylim([0,100])
        ax.set_facecolor("#f5f5f5"); ax.grid(alpha=0.3)
    fig.suptitle(f"Calibrazione TechScore — {len(df_gpx)} GPX reali",fontsize=13,fontweight="bold")
    plt.tight_layout(); plt.savefig(PLOTS_DIR/"wdi_scatter.png",dpi=150,bbox_inches="tight"); plt.close()

def _plot_timing(df_gpx,gpx_cache,timing_calib):
    """Scatter stima vs reale per i 3 profili atleta."""
    vp=timing_calib.get("velocity_params")
    if not vp or not gpx_cache: return
    tup=(vp["k_base"],vp["k_spread"],vp["cap_base"],vp["cap_spread"],
         vp["boost_base"],vp["boost_S"],vp["fatigue_coeff"])
    colors={"top100_men":"#E8593C","avg_finish":"#3B8BD4","top100_women":"#1D9E75"}
    labels={"top100_men":"Top 100 uomini","avg_finish":"Runner medio","top100_women":"Top 100 donne"}
    fig,axes=plt.subplots(1,3,figsize=(18,5)); fig.patch.set_facecolor("#fafafa")
    fig.suptitle("Calibrazione modello a segmenti — stima vs reale",fontsize=13,fontweight="bold")
    for ax,(pk,prof) in zip(axes,ATHLETE_PROFILES.items()):
        col=prof["time_col"]; real_vals=[]; pred_vals=[]
        for _,row in df_gpx.iterrows():
            gid=str(row.get("gpx_id",""))
            if gid not in gpx_cache: continue
            real_h=row.get(col)
            if pd.isna(real_h): continue
            dists,eles_s=gpx_cache[gid]
            vb=prof["vel_base"]*TRAIL_BASE_FACTOR.get(str(row.get("terrain_class","E")),1.0)
            est_h=segment_time(dists,eles_s,vb,prof["S"],tup)/3600
            real_vals.append(float(real_h)); pred_vals.append(est_h)
        if len(real_vals)<2:
            ax.set_title(f"{labels[pk]} — dati insufficienti"); continue
        real_a=np.array(real_vals); pred_a=np.array(pred_vals)
        ax.scatter(real_a,pred_a,c=colors[pk],alpha=0.7,s=55,edgecolors="white",linewidths=0.4)
        mx=max(real_a.max(),pred_a.max())*1.08
        ax.plot([0,mx],[0,mx],"k--",alpha=0.25,lw=1)
        rmse=float(np.sqrt(np.mean((pred_a-real_a)**2)))
        r=float(np.corrcoef(real_a,pred_a)[0,1]) if len(real_a)>2 else float("nan")
        ax.text(0.05*mx,0.93*mx,f"r={r:.3f}  RMSE={rmse:.2f}h",fontsize=9,color=colors[pk],fontweight="bold")
        ax.set_xlabel("Tempo reale (ore)"); ax.set_ylabel("Tempo stimato (ore)")
        ax.set_title(f"{labels[pk]}  n={len(real_vals)}")
        ax.set_facecolor("#f5f5f5"); ax.grid(alpha=0.3)
    plt.tight_layout(); plt.savefig(PLOTS_DIR/"pacing_scatter.png",dpi=150,bbox_inches="tight"); plt.close()

if __name__=="__main__":
    main()
