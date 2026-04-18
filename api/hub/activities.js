/**
 * api/hub/activities.js
 * GET /api/hub/activities?key=TOKEN&alias=ALIAS
 *
 * Utente normale → restituisce le proprie attività + stats aggregate
 * Admin          → restituisce tutte le attività + stats complete
 *
 * Restituisce:
 * {
 *   activities: [...],   // array attività (senza gpx_base64 per alleggerire)
 *   stats: { n_total, n_pending, last_run, last_rmse },
 *   model: { ... },      // parametri modello corrente
 *   plot_rmse: "base64", // grafico evoluzione RMSE (se disponibile)
 *   isAdmin: boolean
 * }
 */

import { checkAuth } from './auth.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis GET error: ${json.error}`);
  return json.result ? JSON.parse(json.result) : null;
}

async function redisKeys(pattern) {
  const res = await fetch(`${UPSTASH_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis KEYS error: ${json.error}`);
  return json.result || [];
}

// Rimuove gpx_base64 prima di inviare al client (troppo pesante per la lista)
function stripGpx(activity) {
  const { gpx_base64, ...rest } = activity;
  return rest;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;

  const alias = req.query?.alias?.trim() || null;

  // Carica tutte le chiavi attività
  const keys = await redisKeys('hub:activities:*');

  // Carica ogni attività in parallelo
  const all = await Promise.all(
    keys.map(k => redisGet(k).catch(() => null))
  );
  const valid = all.filter(Boolean).map(stripGpx);

  // Filtra per alias se utente normale
  const activities = auth.isAdmin
    ? valid.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    : valid
        .filter(a => a.alias === alias)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Stats aggregate (visibili a tutti)
  const stats = (await redisGet('hub:stats')) || {
    n_total: 0, n_pending: 0, last_run: null, last_rmse: null,
  };

  // Modello corrente
  const model = await redisGet('hub:model:current');

  // Grafico RMSE (base64)
  const plot_rmse = await redisGet('hub:plot:rmse');

  // Lista runner autorizzati (solo per admin)
  let authorized_runners = null;
  if (auth.isAdmin) {
    authorized_runners = (await redisGet('hub:authorized_runners')) || [];
  }

  return res.status(200).json({
    ok: true,
    activities,
    stats,
    model,
    plot_rmse,
    isAdmin: auth.isAdmin,
    authorized_runners,
  });
}
