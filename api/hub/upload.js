/**
 * api/hub/upload.js
 * POST /api/hub/upload
 *
 * Riceve JSON con:
 *   key          string  token accesso
 *   alias        string  nome utente
 *   name         string  nome attività (es. "Zegama 2026")
 *   type         string  "personal" | "reference"
 *   gpx_base64   string  file GPX in base64
 *   gpx_filename string  nome file originale
 *   km           number  distanza (estratta lato client dal GPX)
 *   dplus        number  D+ (estratto lato client dal GPX)
 *   time_hours   number  tempo effettivo in ore (opzionale)
 *   technicality number  0–10
 *   tech_label   string  "runnable"|"mixed"|"technical"|"alpine"|"extreme"
 *   comment      string  testo libero (opzionale)
 *
 * Salva su Redis:
 *   hub:activities:{id}  → JSON completo
 *   hub:stats            → aggiorna contatori
 *
 * Restituisce:
 *   { ok: true, id, wdi_estimate }
 */

import { checkAuth } from './auth.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ── Upstash client minimale ───────────────────────────────────────────────────
async function redis(command, ...args) {
  const res = await fetch(`${UPSTASH_URL}/${command}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis error: ${json.error}`);
  return json.result;
}

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value: JSON.stringify(value) }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis SET error: ${json.error}`);
  return json.result;
}

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis GET error: ${json.error}`);
  return json.result ? JSON.parse(json.result) : null;
}

// ── Generatore ID semplice (timestamp + random) ───────────────────────────────
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Stima WDI semplificata lato server ────────────────────────────────────────
// Replica leggera della formula per dare un feedback immediato all'utente.
// La calibrazione vera gira nella pipeline Python.
function estimateWDI(km, dplus, technicality) {
  if (!km || !dplus) return null;
  const kT    = 0.35;
  const REF42 = Math.pow(42, 0.55);

  const dkm  = dplus / 1000;
  const dlkm = dkm; // stima loss = gain
  const VS   = (dkm * 10) / (1 + Math.sqrt(Math.max(dkm, 0.001)) / 8)
             + (dlkm * 4) / (1 + Math.sqrt(Math.max(dlkm, 0.001)) / 6);

  // TechScore proxy dalla technicality (0-10 → 0-100)
  const TS = technicality * 10;

  const DF = km <= 100
    ? Math.pow(km, 0.55) / REF42
    : Math.pow(100, 0.55) / REF42 + (Math.pow(km, 0.42) - Math.pow(100, 0.42)) / REF42 * 0.6;

  return Math.round((VS + TS * kT) * DF * 10) / 10;
}

// ── Validazione input ─────────────────────────────────────────────────────────
function validate(body) {
  const errors = [];

  if (!body.alias?.trim())       errors.push('alias obbligatorio');
  if (!body.name?.trim())        errors.push('nome attività obbligatorio');
  if (!['personal','reference'].includes(body.type))
                                 errors.push('type deve essere personal o reference');
  if (!body.gpx_base64)         errors.push('GPX obbligatorio');
  if (body.gpx_base64?.length > 7_000_000)
                                 errors.push('GPX troppo grande (max ~5MB)');
  if (typeof body.km !== 'number' || body.km <= 0)
                                 errors.push('km non valido');
  if (typeof body.dplus !== 'number' || body.dplus < 0)
                                 errors.push('D+ non valido');
  if (typeof body.technicality !== 'number' ||
      body.technicality < 0 || body.technicality > 10)
                                 errors.push('technicality deve essere tra 0 e 10');
  if (!['runnable','mixed','technical','alpine','extreme'].includes(body.tech_label))
                                 errors.push('tech_label non valido');
  if (body.time_hours !== undefined && body.time_hours !== null) {
    if (typeof body.time_hours !== 'number' || body.time_hours <= 0)
                                 errors.push('time_hours non valido');
  }

  return errors;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  // Validazione
  const errors = validate(body);
  if (errors.length > 0)
    return res.status(400).json({ error: 'Dati non validi', details: errors });

  // Costruisci record
  const id = generateId();
  const activity = {
    id,
    alias:        body.alias.trim(),
    name:         body.name.trim(),
    type:         body.type,
    gpx_base64:   body.gpx_base64,
    gpx_filename: body.gpx_filename || `${id}.gpx`,
    km:           body.km,
    dplus:        body.dplus,
    time_hours:   body.time_hours ?? null,
    technicality: body.technicality,
    tech_label:   body.tech_label,
    comment:      body.comment?.trim() || null,
    status:       'pending',
    timestamp:    new Date().toISOString(),
    wdi_estimate: estimateWDI(body.km, body.dplus, body.technicality),
  };

  // Salva su Redis
  await redisSet(`hub:activities:${id}`, activity);

  // Aggiorna stats
  const stats = (await redisGet('hub:stats')) || { n_total: 0, n_pending: 0, last_run: null, last_rmse: null };
  stats.n_total   += 1;
  stats.n_pending += 1;
  await redisSet('hub:stats', stats);

  return res.status(200).json({
    ok:           true,
    id,
    wdi_estimate: activity.wdi_estimate,
  });
}
