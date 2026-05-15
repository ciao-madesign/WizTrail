/**
 * POST /api/v1/analyze
 *
 * Analizza un tracciato GPX e restituisce WDI, stima tempo e piano pacing.
 * Output identico al calcolatore WizTrail sul sito web.
 *
 * Headers richiesti:
 *   x-api-key: <chiave API>
 *
 * Body JSON:
 *   gpx_base64    {string}  — file GPX/TCX/SML codificato in base64
 *   target_time   {string}  — tempo obiettivo "hh:mm:ss"
 *   specificity   {number}  — livello atleta [0=principiante, 1=elite] (default 0.5)
 *   terrain_class {string}  — 'Strada'|'E'|'EE'|'EA' (default 'EE')
 *   meteo         {number}  — fattore meteo [1=normale, 1.1=pioggia/vento] (default 1)
 *   altitude      {number}  — fattore altitudine [1=piano, 1.05=alta quota] (default 1)
 *   surface_level {number}  — fondo stradale [1-5] (default 3)
 *   granularity_km {number} — dimensione chunk pacing in km [1|2|5|10] (default 5)
 *   vel_base      {number}  — velocità di riferimento su piano km/h (default: derivata da specificity)
 *
 * Response 200:
 *   {
 *     wdi, wdi_norm, wdi_category, class, color,
 *     tech_score, tech_class,
 *     discipline,
 *     max_altitude,
 *     distance_km, dplus,
 *     time_estimate: { seconds, formatted },
 *     avg_pace: { sec_km, formatted },
 *     pacing_plan: [{ km_end, dist_km, pace_sec_km, pace_str, time_str, cumulative_sec, dplus, dminus, faster_than_avg }]
 *   }
 */

import { checkRateLimit, getIP } from '../lib/ratelimit.js';
import { parseTrack, compute }   from '../lib/gpx-node.js';
import { computeFromGpx, classifyDiscipline } from '../lib/engine-node.js';
import { computeTime }           from '../lib/timing-node.js';
import { generatePacingPlan, serializeChunks, secToHMS } from '../lib/pacing-node.js';

/* ── Auth ─────────────────────────────────────────────────────────── */

function checkApiKey(req) {
  const keys = (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!keys.length) return false; // env var not configured → deny
  const provided = req.headers['x-api-key'] || '';
  return keys.includes(provided);
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function parseDuration(str) {
  if (!str) return null;
  const m = str.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

// Velocità base (km/h su piano su strada) stimata dalla specificità.
// Rispecchia la mappatura usata nel calcolatore del sito.
function velBaseFromSpecificity(S) {
  return 6 + S * 6; // 6 km/h (principiante) → 12 km/h (elite)
}

/* ── Handler ──────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Autenticazione ──
  if (!checkApiKey(req)) {
    return res.status(401).json({ error: 'API key non valida o mancante.' });
  }

  // ── Rate limiting ──
  const ip = getIP(req);
  const rl = await checkRateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', rl.remaining);
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Troppe richieste. Riprova tra un minuto.' });
  }

  // ── Parsing body ──
  const {
    gpx_base64,
    target_time,
    specificity    = 0.5,
    terrain_class  = 'EE',
    meteo          = 1,
    altitude       = 1,
    surface_level  = 3,
    granularity_km = 5,
    vel_base,
  } = req.body || {};

  if (!gpx_base64) {
    return res.status(400).json({ error: 'Campo gpx_base64 obbligatorio.' });
  }

  // ── Decode GPX ──
  let xmlStr;
  try {
    xmlStr = Buffer.from(gpx_base64, 'base64').toString('utf-8');
  } catch {
    return res.status(400).json({ error: 'gpx_base64 non è un base64 valido.' });
  }

  if (xmlStr.length > 10_000_000) {
    return res.status(413).json({ error: 'File GPX troppo grande (max ~10 MB).' });
  }

  // ── Parse traccia ──
  let gpxPts;
  try {
    gpxPts = parseTrack(xmlStr);
  } catch (e) {
    return res.status(400).json({ error: 'Impossibile parsare il file GPX.' });
  }

  if (!gpxPts || gpxPts.length < 2) {
    return res.status(400).json({ error: 'Traccia GPX vuota o non valida.' });
  }

  // ── Metriche ──
  const metrics = compute(gpxPts);

  if (metrics.km < 0.5) {
    return res.status(400).json({ error: 'Traccia troppo corta (min 0.5 km).' });
  }

  // ── WDI ──
  const wdiResult = computeFromGpx(metrics, surface_level);

  // ── Disciplina ──
  const discipline = classifyDiscipline({
    distance_km:  metrics.km,
    dplus:        metrics.gain,
    max_altitude: metrics.max_altitude,
  });

  // ── Stima tempo ──
  const S      = Math.max(0, Math.min(1, Number(specificity)));
  const vBase  = vel_base ? Number(vel_base) : velBaseFromSpecificity(S);
  const tEst   = computeTime(gpxPts, metrics, vBase, S, terrain_class,
                              Number(meteo), Number(altitude));

  // ── Pacing plan ──
  const T_target = parseDuration(target_time) ?? Math.round(tEst);
  const gran     = [1, 2, 5, 10].includes(Number(granularity_km)) ? Number(granularity_km) : 5;

  const pacingResult = generatePacingPlan({
    gpxPts,
    metrics,
    params: { terrainClass: terrain_class, meteo: Number(meteo), alt: Number(altitude) },
    T_target_sec: T_target,
    gran_km: gran,
  });

  if (pacingResult.error) {
    return res.status(400).json({ error: pacingResult.error });
  }

  const chunks = serializeChunks(pacingResult.pacingChunks, pacingResult.avg_pace_sec);

  // ── Risposta ──
  return res.status(200).json({
    wdi:          wdiResult.WDI,
    wdi_norm:     wdiResult.WDI_norm,
    wdi_category: wdiResult.WDI_category,
    class:        wdiResult.class,
    color:        wdiResult.color,
    tech_score:   wdiResult.TechScore,
    tech_class:   wdiResult.techClass,
    discipline,
    max_altitude: Math.round(metrics.max_altitude),
    distance_km:  Math.round(metrics.km * 10) / 10,
    dplus:        Math.round(metrics.gain),
    time_estimate: {
      seconds:   Math.round(tEst),
      formatted: secToHMS(tEst),
    },
    avg_pace: {
      sec_km:    Math.round(pacingResult.avg_pace_sec),
      formatted: `${Math.floor(pacingResult.avg_pace_sec / 60)}:${String(Math.round(pacingResult.avg_pace_sec % 60)).padStart(2,'0')}/km`,
    },
    pacing_plan: chunks,
  });
}
