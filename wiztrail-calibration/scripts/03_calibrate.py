"""
Script 03 — Calibrazione WDI + Modello Tempi (v2)
──────────────────────────────────────────────────
Parte A: pesi buildTechScore() ottimizzati su 47 GPX reali
Parte B: modello tempi con formula log-lineare robusta
         T = base_pace * km * (1 + ce*gain/1000) * (1 + ct*tech/10) * (km/42)^ed
         TOR escluso dalla calibrazione base (outlier distanza >250km)
         Calibrazione separata per profilo: avg_finish, top100_men, top100_women
"""
import json, math, warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.optimize import differential_evolution
from pathlib import Path

warnings.filterwarnings("ignore")
DATA_DIR=Path("data"); OUTPUT_DIR=Path("output"); PLOTS_DIR=OUTPUT_DIR/"plots"
OUTPUT_DIR.mkdir(exist_ok=True); PLOTS_DIR.mkdir(exist_ok=True)

kT=0.35; REF42=math.pow(42,0.55)

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
#  PARTE B — Modello tempi
# ══════════════════════════════════════════════════════
def predict_h(bp,ce,ct,ed,km,gain,tech):
    """Stima ore di completamento."""
    fEl=1+ce*(gain/1000.)
    fTe=1+ct*(tech/10.)
    fDi=math.pow(max(km,1)/42.,ed)
    return (bp*km/60.)*fEl*fTe*fDi

def pacing_obj(params,df,tcol,wcol):
    bp,ce,ct,ed=params
    if bp<=0 or ce<0 or ct<0 or ed<=0: return 1e9
    preds=df.apply(lambda r: predict_h(bp,ce,ct,ed,
        r["km_eff"],r["gain_eff"],r["technicality"]),axis=1).values
    target=df[tcol].values; valid=~np.isnan(target)
    if valid.sum()<3: return 1e9
    return float(np.sqrt(np.average((preds[valid]-target[valid])**2,
                                     weights=df[wcol].values[valid])))

def main():
    df=pd.read_csv(DATA_DIR/"computed.csv"); df=enrich_df(df)
    print(f"  Gare totali: {len(df)}")

    # ── A ────────────────────────────────────────────────────────────────────
    df_gpx=df[df["calc_source"]=="gpx"].dropna(
        subset=["gpx_frip","gpx_slope_var","gpx_roughness","gpx_gain","gpx_km","technicality"])
    n=len(df_gpx); print(f"\n  [A] TechScore — {n} GPX")
    wdi_calib={}; xo=[0.60,0.55,0.35,150.,0.45,0.35,0.20,0.30,0.70]
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
    # Modello tempi: calibrazione per tipo di gara
    # Skyrace (D+/km > 60m): ritmo molto più lento per terreno ripido e tecnico
    # Trail/Ultra (D+/km ≤ 60m): ritmo più sostenuto
    df_pace=df[df["km_eff"]<=250].copy()
    df_pace["dplus_per_km"]=df_pace["gain_eff"]/df_pace["km_eff"].clip(lower=1)
    df_pace["race_type"]=df_pace["dplus_per_km"].apply(
        lambda x: "skyrace" if x>60 else "trail_ultra")

    n_sky=len(df_pace[df_pace["race_type"]=="skyrace"].dropna(subset=["avg_finish_hours"]))
    n_tra=len(df_pace[df_pace["race_type"]=="trail_ultra"].dropna(subset=["avg_finish_hours"]))
    print(f"\n  [B] Modello tempi  (skyrace: {n_sky}  trail/ultra: {n_tra}  escluse >250km o senza tempi)")

    pacing_results={}
    PROFILES={
        "avg_finish":   ("avg_finish_hours","Runner medio","#3B8BD4"),
        "top100_men":   ("avg_top100_men_hours","Top 100 uomini","#E8593C"),
        "top100_women": ("avg_top100_women_hours","Top 100 donne","#1D9E75"),
    }
    pbounds=[(3.0,18.0),(0.02,2.0),(0.0,2.0),(0.70,1.40)]

    for pk,(col,label,color) in PROFILES.items():
        if col not in df.columns: continue

        cluster_results={}
        for ctype,cname in [("skyrace","Skyrace"),("trail_ultra","Trail/Ultra")]:
            df_t=df_pace[df_pace["race_type"]==ctype].dropna(
                subset=[col,"km_eff","gain_eff","technicality"]).copy()
            n_t=len(df_t)
            if n_t<3: continue
            bp0=(df_t[col]*60/df_t["km_eff"]).median()
            x0p=[min(bp0,16.),0.20,0.40,1.00]
            rb=pacing_obj(x0p,df_t,col,"feedback_affidability")
            res_p=differential_evolution(pacing_obj,pbounds,
                args=(df_t,col,"feedback_affidability"),
                seed=42,maxiter=500,tol=1e-9,workers=1,polish=True)
            xp=res_p.x; ra=res_p.fun
            cluster_results[ctype]={
                "base_pace_min_km":round(float(xp[0]),3),
                "coeff_elev":round(float(xp[1]),4),
                "coeff_tech":round(float(xp[2]),4),
                "expo_dist":round(float(xp[3]),4),
                "rmse_hours":round(float(ra),3),"n_races":n_t}
            print(f"     {label} [{cname}]: n={n_t}  RMSE→{ra:.2f}h  "
                  f"pace={xp[0]:.1f}min/km  ce={xp[1]:.3f}  ct={xp[2]:.3f}")

        if cluster_results:
            checks=_sanity_check_v2(df,cluster_results,col)
            pacing_results[pk]={
                "label":label,"clusters":cluster_results,"sanity_checks":checks}
            print(f"     Sanity check {label}:")
            for race,est,real in checks:
                diff=est-real; sign="↑" if diff>0 else "↓"
                print(f"       {race[:30]:<30}: stima={est:.1f}h  reale={real:.1f}h  {sign}{abs(diff):.1f}h")

    _plot_wdi(df_gpx,xo,wdi_calib)
    _plot_pacing(df_pace,pacing_results,PROFILES)

    (OUTPUT_DIR/"1_wdi_calibration.json").write_text(json.dumps(wdi_calib,indent=2,ensure_ascii=False))
    (OUTPUT_DIR/"2_pacing_coefficients.json").write_text(json.dumps(pacing_results,indent=2,ensure_ascii=False))
    print(f"\n  ✓  Output salvati in output/")

def _sanity_check(df,xp,col):
    checks=[]
    benchmarks=["UTMB","CCC","Zegama-Aizkorri","Western States 100","Sierre-Zinal"]
    for race in benchmarks:
        row=df[df["race"]==race]
        if row.empty: continue
        r=row.iloc[0]
        if pd.isna(r.get(col)) or pd.isna(r.get("gpx_km",r.get("distance_km"))): continue
        km=r["gpx_km"] if pd.notna(r.get("gpx_km")) else r["distance_km"]
        gain=r["gpx_gain"] if pd.notna(r.get("gpx_gain")) else r["elevation_m"]
        est=predict_h(xp[0],xp[1],xp[2],xp[3],km,gain,r["technicality"])
        checks.append((race,round(est,1),round(r[col],1)))
    return checks

def _sanity_check_v2(df,cluster_results,col):
    import math
    benchmarks=["UTMB","CCC","Zegama-Aizkorri","Western States 100","Sierre-Zinal",
                "Speedgoat 50K","Hardrock 100","Tarawera 100K"]
    checks=[]
    for race in benchmarks:
        row=df[df["race"]==race]
        if row.empty: continue
        r=row.iloc[0]
        if pd.isna(r.get(col)): continue
        km_eff=r["gpx_km"] if pd.notna(r.get("gpx_km")) else r.get("distance_km")
        gain_eff=r["gpx_gain"] if pd.notna(r.get("gpx_gain")) else r.get("elevation_m")
        if pd.isna(km_eff) or pd.isna(gain_eff): continue
        dkm=gain_eff/max(km_eff,1)
        ctype="skyrace" if dkm>60 else "trail_ultra"
        if ctype not in cluster_results: continue
        cr=cluster_results[ctype]
        est=predict_h(cr["base_pace_min_km"],cr["coeff_elev"],cr["coeff_tech"],
                      cr["expo_dist"],km_eff,gain_eff,r["technicality"])
        checks.append((race,round(est,1),round(r[col],1)))
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

def _plot_pacing(df_pace,pacing_results,profiles):
    import math as _math
    n=len(pacing_results)
    if n==0: return
    fig,axes=plt.subplots(1,n,figsize=(6*n,5)); axes=[axes] if n==1 else list(axes)
    fig.patch.set_facecolor("#fafafa"); fig.suptitle("Calibrazione modello tempi",fontsize=13,fontweight="bold")
    for ax,(pk,pr) in zip(axes,pacing_results.items()):
        col,label,color=profiles[pk]
        d=df_pace.dropna(subset=[col,"km_eff","gain_eff","technicality"]).copy()
        d["race_type_"]=d["dplus_per_km"].apply(lambda x: "skyrace" if x>60 else "trail_ultra")
        def est_row(r):
            ct=r["race_type_"]
            if ct not in pr["clusters"]: return float("nan")
            cr=pr["clusters"][ct]
            return predict_h(cr["base_pace_min_km"],cr["coeff_elev"],cr["coeff_tech"],
                             cr["expo_dist"],r["km_eff"],r["gain_eff"],r["technicality"])
        pred=d.apply(est_row,axis=1)
        valid=pred.notna()
        real=d.loc[valid,col]; pred=pred[valid]
        ax.scatter(real,pred,c=color,alpha=0.7,s=55,edgecolors="white",linewidths=0.4)
        mx=max(real.max(),pred.max())*1.08
        ax.plot([0,mx],[0,mx],"k--",alpha=0.25,lw=1)
        if len(real)>1:
            rr=np.corrcoef(real,pred)[0,1]
            ax.text(0.5,mx*0.93,f"r = {rr:.3f}",fontsize=10,color=color,fontweight="bold")
        n_tot=sum(c["n_races"] for c in pr["clusters"].values())
        rmse_tot=float(np.sqrt(np.mean((pred.values-real.values)**2)))
        ax.set_xlabel("Tempo reale (ore)"); ax.set_ylabel("Tempo stimato (ore)")
        ax.set_title(f"{label}  n={n_tot}  RMSE={rmse_tot:.2f}h")
        ax.set_facecolor("#f5f5f5"); ax.grid(alpha=0.3)
    plt.tight_layout(); plt.savefig(PLOTS_DIR/"pacing_scatter.png",dpi=150,bbox_inches="tight"); plt.close()

if __name__=="__main__":
    main()
# versione aggiornata con modello per tipo gara — vedi run successivo
