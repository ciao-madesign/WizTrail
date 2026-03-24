/* ===============================================================
   WIZTRAIL – WDI ENGINE 9.1 (Difficulty of Race Course)
   Modello finale:
   - Distanza_eff = (km - 1.5*sqrt(km)) + (50 / sqrt(km))
   - Dplus_eff = (D+km*10) / (1 + sqrt(D+km) / 8)
   - Pendenza media assoluta
   - TecFactor 1.01–1.10 (tecnica, roughness, max-slope)
   - Soglie: Sport, Pro, Advanced, Extreme, Elite, Legend
   =============================================================== */

window.WizTrailWDI = (function () {

  /* ---------------------------------------------------------------
     1) COMPONENTI PRINCIPALI
     --------------------------------------------------------------- */

  // Smorzamento D+
  function computeDplusTerm(gainMeters){
    const km = gainMeters / 1000;
    if(km <= 0) return 0;
    return (km * 10) / (1 + Math.sqrt(km) / 8);
  }

  // Distanza compattata
  function computeDistanceEff(km){
    if(km <= 0) return 0;
    const root = Math.sqrt(km);
    return (km - 1.5 * root) + (50 / root);
  }

  // Pendenza media assoluta (%)
  function computeAvgSlopePct(gain, km){
    if(km <= 0) return 0;
    return Math.abs((gain / (km * 1000)) * 100);
  }

  /* ---------------------------------------------------------------
     2) TECNICALITÀ con peso moderato (TecFactor 1.01–1.10)
     --------------------------------------------------------------- */
  function computeTechnicalFactor(metrics, slopes){

    // max pendenza salita/discesa
    let maxUp = 0, maxDown = 0;
    for(let s of slopes){
      if(s > maxUp) maxUp = s;
      if(s < maxDown) maxDown = s;
    }
    maxDown = Math.abs(maxDown);

    // variabilità ridotta (rumore GPS quasi neutralizzato)
    let nVar = 0;
    for(let i=1;i<slopes.length;i++){
      if(Math.abs(slopes[i] - slopes[i-1]) > 0.03) nVar++;
    }
    const varNorm = (slopes.length > 0 && metrics.km > 0)
      ? (nVar / slopes.length) * 0.10   // peso molto basso
      : 0;

    // roughness molto attenuato
    let rough = 0;
    for(let i=1;i<slopes.length;i++){
      rough += Math.abs(slopes[i] - slopes[i-1]);
    }
    const roughNorm = (slopes.length > 0)
      ? (rough / slopes.length) * 0.10
      : 0;

    // combinazione tecnica normalizzata
    let raw =
        (maxUp  / 0.40) * 0.20 +     // max slope su 40%
        (maxDown/ 0.40) * 0.10 +
         varNorm +
         roughNorm;

    if(raw < 0) raw = 0;
    if(raw > 1) raw = 1;

    // range 1.01 → 1.10
    return 1.01 + raw * 0.09;
  }

  /* ---------------------------------------------------------------
     3) SLOPES punto-punto
     --------------------------------------------------------------- */
  function computeSlopes(d, e){
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
     4) CLASSIFICAZIONE (nuove soglie)
     --------------------------------------------------------------- */
  function classify(wdi){
    if(wdi < 30)  return "Sport";
    if(wdi < 75)  return "Pro";
    if(wdi < 120) return "Advanced";
    if(wdi < 180) return "Extreme";
    if(wdi < 350) return "Elite";
    return "Legend";
  }

  /* ---------------------------------------------------------------
     5) COLORI coerenti con categorizzazione
     --------------------------------------------------------------- */
  function getColor(wdi){
    if(wdi < 30)  return "#2BB7DA"; // Sport
    if(wdi < 75)  return "#34A853"; // Pro
    if(wdi < 120) return "#F4C20D"; // Advanced
    if(wdi < 180) return "#F79617"; // Extreme
    if(wdi < 350) return "#E91E63"; // Elite
    return "#8E24AA";               // Legend
  }

  /* ---------------------------------------------------------------
     6) MOTORE PRINCIPALE
     --------------------------------------------------------------- */
  return {
    computeFromGpx: function(pts, metrics){

      const km = metrics.km;
      const gain = metrics.gain;

      // slopes
      const slopes = computeSlopes(metrics.d, metrics.e);

      // componenti principali
      const DistEff    = computeDistanceEff(km);
      const DplusTerm  = computeDplusTerm(gain);
      const SlopePct   = computeAvgSlopePct(gain, km);

      // fattore tecnico
      const TecFactor  = computeTechnicalFactor(metrics, slopes);

      // modello finale
      const WDI_base =
          DistEff +
          DplusTerm +
          SlopePct;

      const WDI = WDI_base * TecFactor;

      return {
        WDI,
        class: classify(WDI),
        color: getColor(WDI),
        factors: {
          km,
          gain,
          DistEff,
          DplusTerm,
          SlopePct,
          TecFactor
        }
      };
    }
  };

})();