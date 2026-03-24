/* ===============================================================
   WIZTRAIL – WDIT ENGINE 7.0 (LINEAR MODEL)
   Basato su tabella di calibrazione approvata.
   - Crescita lineare di distanza e D+
   - Fattori tecnici lineari
   - Nessuna normalizzazione o compressione 0–1
   - Punteggi aperti (0 → 4+)
   =============================================================== */

window.WizTrailWDIT = (function () {

  /* ---------------------------------------------------------------
     COEFFICIENTI LINEARI (derivati da calibrazione v7)
     --------------------------------------------------------------- */
  const kD    = 0.015;    // distanza
  const kH    = 0.00025;  // dislivello
  const kVar  = 0.40;     // variabilità tecnica
  const kRip  = 0.35;     // ripidità
  const kProf = 0.20;     // profilo / roughness

  function clamp(x,min,max){ return Math.max(min,Math.min(max,x)); }

  /* ---------------------------------------------------------------
     CALCOLO SLOPES (pendenze reali)
     --------------------------------------------------------------- */
  function computeSlopes(metrics){
    const d=metrics.d, e=metrics.e;
    const slopes=[];
    for(let i=1;i<d.length;i++){
      const dd = d[i]-d[i-1];
      if(dd>0){
        slopes.push((e[i]-e[i-1]) / dd);
      }
    }
    return slopes;
  }

  /* ---------------------------------------------------------------
     FVAR — variabilità significativa (lineare)
     --------------------------------------------------------------- */
  function computeFVAR(slopes){
    const significant = slopes.filter(s => Math.abs(s) > 0.03);
    const density = significant.length / slopes.length;
    return density;   // nessuna normalizzazione 0–1
  }

  /* ---------------------------------------------------------------
     FRIP — pendenza massima su finestra 40m (lineare)
     --------------------------------------------------------------- */
  function computeFRIP(metrics){
    const d = metrics.d, e = metrics.e;
    let maxSlope = 0;

    for(let i=0;i<d.length;i++){
      let j=i;
      while(j<d.length && d[j] < d[i]+40) j++;
      if(j>=d.length) break;
      const slope = (e[j] - e[i]) / Math.max(1, (d[j]-d[i]));
      maxSlope = Math.max(maxSlope, Math.abs(slope));
    }

    return maxSlope;   // valore reale (es 0.35 = 35%)
  }

  /* ---------------------------------------------------------------
     FEXTRA — roughness profilo (lineare ma limitata)
     --------------------------------------------------------------- */
  function computeFEXTRA(slopes){
    let sum=0;
    for(let i=1;i<slopes.length;i++){
      sum += Math.abs(slopes[i] - slopes[i-1]);
    }
    return sum / slopes.length;
  }

  /* ---------------------------------------------------------------
     CLASSIFICAZIONE — su scala aperta (nuove soglie verranno definite)
     --------------------------------------------------------------- */
function classify(score){
  if(score < 0.45) return "leggero";
  if(score < 0.80) return "buono";
  if(score < 1.20) return "impegnativo";
  if(score < 2.20) return "molto impegnativo";
  if(score < 8.00) return "estremo";
  return "leggendario";
}

function getWditInfo(score){
  if(score < 0.45) return { level: "leggero",           color: "#2BB7DA" };
  if(score < 0.80) return { level: "buono",             color: "#34A853" };
  if(score < 1.20) return { level: "impegnativo",       color: "#F4C20D" };
  if(score < 2.20) return { level: "molto impegnativo", color: "#F79617" };
  if(score < 8.00) return { level: "estremo",           color: "#E91E63" };
  return                           { level: "leggendario",       color: "#8E24AA" };
}
  /* ---------------------------------------------------------------
     MOTORE PRINCIPALE
     --------------------------------------------------------------- */
  return {
    computeFromGpx: function(gpxPts, metrics){
      const slopes = computeSlopes(metrics);

      const f = {
        dist: metrics.km,
        gain: metrics.gain,
        FVAR : computeFVAR(slopes),
        FRIP : computeFRIP(metrics),
        FEXTRA : computeFEXTRA(slopes)
      };

      const score =
          (f.dist  * kD)
        + (f.gain  * kH)
        + (f.FVAR  * kVar)
        + (f.FRIP  * kRip)
        + (f.FEXTRA * kProf);

      return {
        WDIT: score,
        class: classify(score),
        factors: f
      };
    }
  };

})();