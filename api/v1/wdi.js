/**
 * POST /api/v1/wdi
 *
 * Calcola una stima WDI da input manuali (senza GPX).
 * Meno preciso di /api/v1/analyze: usa valori di default per le caratteristiche
 * del terreno non rilevabili senza tracciato reale.
 * La risposta include "estimate: true" come indicatore di accuratezza ridotta.
 *
 * Headers richiesti:
 *   x-api-key: <chiave API>
 *
 * Body JSON:
 *   distance_km    {number}  — distanza totale in km            [obbligatorio]
 *   dplus          {number}  — dislivello positivo in metri     [obbligatorio]
 *   dminus         {number}  — dislivello negativo in metri     (default: uguale a dplus)
 *   terrain_cat    {string}  — 'E'|'EE'|'EA'                   (default 'EE')
 *   surface_level  {number}  — fondo [1-5]                      (default 3)
 *   avg_altitude   {number}  — quota media in metri             (default 800)
 *   max_altitude   {number}  — quota massima in metri           (default 0)
 *   specificity    {number}  — livello atleta [0=principiante, 1=elite] (default 0.5)
 *   terrain_class  {string}  — 'Strada'|'E'|'EE'|'EA' (default: terrain_cat)
 *
 * Response 200:
 *   {
 *     estimate: true,
 *     wdi, wdi_norm, wdi_category, class, color,
 *     tech_score, tech_class,
 *     discipline,
 *     distance_km, dplus,
 *     specificity, level,
 *     terrain_factor,                 // correzione terreno applicata al tempo (>= 1), come nel sito
 *     time_estimate: { seconds, formatted },
 *     median_comparison: { median_sec, median_formatted }
 *   }
 */

import { checkRateLimit, getIP } from '../../server/ratelimit.js';
import { checkApiKey } from '../../server/auth.js';
import { computeManual, classifyDiscipline } from '../../server/engine-node.js';
import { computeTimeManual, levelFromS, estimateMedianTime, terrainFactor } from '../../server/timing-node.js';

function secToHMS(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/* ── Handler ──────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit per IP PRIMA della verifica chiave: limita anche i tentativi con chiavi errate
  const ip = getIP(req);
  const rl = await checkRateLimit(ip, 'v1');
  res.setHeader('X-RateLimit-Remaining', rl.remaining);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter || 60));
    return res.status(429).json({ ok: false, code: 'RATE_LIMITED', error: 'Troppe richieste. Riprova tra un minuto.' });
  }

  // Autenticazione (dopo il rate limit)
  if (!(await checkApiKey(req))) {
    return res.status(401).json({ ok: false, code: 'INVALID_API_KEY', error: 'API key non valida o mancante.' });
  }


  const {
    distance_km,
    dplus,
    dminus,
    terrain_cat   = 'EE',
    surface_level = 3,
    avg_altitude  = 800,
    max_altitude  = 0,
    specificity   = 0.5,
    terrain_class,
  } = req.body || {};

  if (!distance_km || !dplus) {
    return res.status(400).json({ error: 'Campi distance_km e dplus obbligatori.' });
  }

  const km   = Number(distance_km);
  const gain = Number(dplus);
  const loss = dminus !== undefined ? Number(dminus) : gain;

  if (km <= 0 || gain < 0) {
    return res.status(400).json({ error: 'Valori non validi per distance_km o dplus.' });
  }

  const result = computeManual({
    km,
    gain,
    loss,
    terrainCat:   terrain_cat,
    surfaceLevel: Number(surface_level),
    altMedia:     Number(avg_altitude),
  });

  const discipline = classifyDiscipline({ distance_km: km, dplus: gain, max_altitude: Number(max_altitude) });

  const S          = Math.max(0, Math.min(1, Number(specificity)));
  const tClass     = terrain_class || terrain_cat || 'EE';
  // Correzione terreno (stessa del sito, main.js): T_finale = T_segmenti × terrainFactor(TechScore, S).
  // Usa TechScore (stimato dal terreno dichiarato), non il WDI: vedi CLAUDE.md, sezione Pacing e timing.
  const kf         = terrainFactor(result.TechScore, S);
  const tEst       = computeTimeManual(km, gain, S, tClass) * kf;
  const altMedia   = Number(avg_altitude);
  const tMedian    = estimateMedianTime(km, gain, altMedia);

  return res.status(200).json({
    estimate:     true,
    wdi:          result.WDI,
    wdi_norm:     result.WDI_norm,
    wdi_category: result.WDI_category,
    class:        result.class,
    color:        result.color,
    tech_score:   result.TechScore,
    tech_class:   result.techClass,
    discipline,
    distance_km:  Math.round(km * 10) / 10,
    dplus:        Math.round(gain),
    specificity:  S,
    level:        levelFromS(S),
    terrain_factor: Math.round(kf * 1000) / 1000,
    time_estimate: {
      seconds:   Math.round(tEst),
      formatted: secToHMS(tEst),
    },
    median_comparison: tMedian ? {
      median_sec:       Math.round(tMedian),
      median_formatted: secToHMS(tMedian),
    } : null,
  });
}
