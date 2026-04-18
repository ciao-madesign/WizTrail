/**
 * api/hub/upload.js
 * POST /api/hub/upload
 */
import { checkAuth } from './auth.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function cmd(args) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Upstash: ${json.error}`);
  return json.result;
}

async function get(key) {
  const r = await cmd(['GET', key]);
  if (r === null) return null;
  try { return JSON.parse(r); } catch { return r; }
}

async function set(key, value) {
  return cmd(['SET', key, JSON.stringify(value)]);
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function estimateWDI(km, dplus, technicality) {
  if (!km || !dplus) return null;
  const REF42 = Math.pow(42, 0.55);
  const dkm   = dplus / 1000;
  const dlkm  = dkm;
  const VS    = (dkm  * 10) / (1 + Math.sqrt(Math.max(dkm,  0.001)) / 8)
              + (dlkm *  4) / (1 + Math.sqrt(Math.max(dlkm, 0.001)) / 6);
  const TS    = technicality * 10;
  const DF    = km <= 100
    ? Math.pow(km, 0.55) / REF42
    : Math.pow(100, 0.55) / REF42 + (Math.pow(km, 0.42) - Math.pow(100, 0.42)) / REF42 * 0.6;
  return Math.round((VS + TS * 0.35) * DF * 10) / 10;
}

function validate(body) {
  const errors = [];
  if (!body.alias?.trim())       errors.push('alias obbligatorio');
  if (!body.name?.trim())        errors.push('nome attività obbligatorio');
  if (!['personal','reference'].includes(body.type)) errors.push('type non valido');
  if (!body.gpx_base64)         errors.push('GPX obbligatorio');
  if (body.gpx_base64?.length > 7_000_000) errors.push('GPX troppo grande (max ~5MB)');
  if (typeof body.km !== 'number' || body.km <= 0) errors.push('km non valido');
  if (typeof body.dplus !== 'number' || body.dplus < 0) errors.push('D+ non valido');
  if (typeof body.technicality !== 'number' || body.technicality < 0 || body.technicality > 10)
    errors.push('technicality deve essere tra 0 e 10');
  if (!['runnable','mixed','technical','alpine','extreme'].includes(body.tech_label))
    errors.push('tech_label non valido');
  if (body.time_hours !== undefined && body.time_hours !== null) {
    if (typeof body.time_hours !== 'number' || body.time_hours <= 0)
      errors.push('time_hours non valido');
  }
  return errors;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  const errors = validate(body);
  if (errors.length > 0) return res.status(400).json({ error: 'Dati non validi', details: errors });

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

  await set(`hub:activities:${id}`, activity);

  const stats = (await get('hub:stats')) || { n_total: 0, n_pending: 0, last_run: null, last_rmse: null };
  await set('hub:stats', { ...stats, n_total: (stats.n_total || 0) + 1, n_pending: (stats.n_pending || 0) + 1 });

  return res.status(200).json({ ok: true, id, wdi_estimate: activity.wdi_estimate });
}
