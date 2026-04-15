/* ===============================================================
   WIZTRAIL OSM ENGINE — Enhanced Terrain Mode
   Caricato dinamicamente da main.js solo se utente attiva il toggle.
   Sempre fallback silenzioso su errore/timeout (5s).
   Espone: window.WizOSM
   =============================================================== */

window.WizOSM = (function () {

  const NEUTRAL = 45;
  const TIMEOUT = 5000;

  const surfaceScore  = { asphalt:5,paved:5,compacted:10,fine_gravel:20,gravel:35,dirt:40,ground:45,grass:50,sand:60,mud:80,rock:85,roots:75 };
  const tracktypeMod  = { grade1:-10,grade2:-5,grade3:0,grade4:10,grade5:20 };
  const smoothnessMod = { excellent:-15,good:-10,intermediate:0,bad:15,very_bad:25,horrible:35,very_horrible:45 };
  const sacScore      = { hiking:10,mountain_hiking:30,demanding_mountain_hiking:50,alpine_hiking:70,difficult_alpine_hiking:85 };

  function computeTerrainDifficulty(tags) {
    if (!tags) return { score: NEUTRAL, confidence: 0 };
    let score = 0, w = 0;
    if (tags.surface    && surfaceScore[tags.surface]    !== undefined) { score += surfaceScore[tags.surface] * 0.6;                   w += 0.6; }
    if (tags.tracktype  && tracktypeMod[tags.tracktype]  !== undefined) { score += (NEUTRAL + tracktypeMod[tags.tracktype]) * 0.2;     w += 0.2; }
    if (tags.smoothness && smoothnessMod[tags.smoothness]!== undefined) { score += (NEUTRAL + smoothnessMod[tags.smoothness]) * 0.2;   w += 0.2; }
    if (w === 0 && tags.sac_scale && sacScore[tags.sac_scale]) return { score: sacScore[tags.sac_scale], confidence: 0.3 };
    if (w === 0) return { score: NEUTRAL, confidence: 0 };
    return { score: Math.max(0, Math.min(100, score / w)), confidence: w };
  }

  function aggregate(scores) {
    let total = 0, tw = 0;
    for (const s of scores) { total += s.score * s.confidence; tw += s.confidence; }
    if (!tw) return { score: NEUTRAL, confidence: 0 };
    return { score: Math.round(total / tw), confidence: Math.min(tw / scores.length, 1) };
  }

  function downsample(gpxPts, metrics, stepM) {
    stepM = stepM || 200;
    const pts = []; let next = 0;
    for (let i = 0; i < metrics.d.length; i++) {
      if (metrics.d[i] >= next) { pts.push(gpxPts[i]); next += stepM; }
    }
    return pts;
  }

  return {
    analyze: async function (gpxPts, metrics) {
      try {
        const samples = downsample(gpxPts, metrics, 200);
        if (!samples.length) return { score: NEUTRAL, confidence: 0 };

        const lats = samples.map(function(p){ return p[0]; });
        const lons = samples.map(function(p){ return p[1]; });
        const bbox = [Math.min.apply(null,lats)-0.001, Math.min.apply(null,lons)-0.001,
                      Math.max.apply(null,lats)+0.001, Math.max.apply(null,lons)+0.001].join(',');

        const ctrl = new AbortController();
        const tid  = setTimeout(function(){ ctrl.abort(); }, TIMEOUT);
        let osmData;
        try {
          const res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: 'data=' + encodeURIComponent(
              '[out:json][timeout:10];way(' + bbox + ')[highway~"path|track|footway|bridleway"];out tags;'
            ),
            signal: ctrl.signal
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          osmData = await res.json();
        } finally { clearTimeout(tid); }

        const ways   = osmData.elements || [];
        const scores = samples.map(function() {
          const found = ways.find(function(w){ return w.tags && (w.tags.surface || w.tags.tracktype || w.tags.sac_scale); });
          return computeTerrainDifficulty(found ? found.tags : null);
        });
        return aggregate(scores);

      } catch (err) {
        console.warn('WizOSM fallback:', err.message);
        return { score: NEUTRAL, confidence: 0 };
      }
    }
  };
})();
