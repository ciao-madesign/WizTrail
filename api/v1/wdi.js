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
 *
 * Response 200:
 *   {
 *     estimate: true,
 *     wdi, wdi_norm, wdi_category, class, color,
 *     tech_score, tech_class,
 *     discipline,
 *     distance_km, dplus
 *   }
 */

import { checkRateLimit, getIP } from '../lib/ratelimit.js';
import { computeManual, classifyDiscipline } from '../lib/engine-node.js';

/* ── Auth ─────────────────────────────────────────────────────────── */

function checkApiKey(req) {
  const keys = (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!keys.length) return false;
  return keys.includes(req.headers['x-api-key'] || '');
}

/* ── Handler ──────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!checkApiKey(req)) {
    return res.status(401).json({ error: 'API key non valida o mancante.' });
  }

  const ip = getIP(req);
  const rl = await checkRateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', rl.remaining);
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Troppe richieste. Riprova tra un minuto.' });
  }

  const {
    distance_km,
    dplus,
    dminus,
    terrain_cat   = 'EE',
    surface_level = 3,
    avg_altitude  = 800,
    max_altitude  = 0,
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
  });
}
