/**
 * api/hub/patch.js
 * POST /api/hub/patch
 *
 * Riceve i risultati della pipeline da GitHub Actions (via 06_push_results.py).
 * Aggiorna hub:model:current, hub:plot:rmse, hub:stats.
 * Viene chiamato dalla pipeline Python al termine della calibrazione.
 *
 * Body: {
 *   key:              HUB_ADMIN_TOKEN (autenticazione pipeline)
 *   wdi_calibration:  { tech_score_weights, norm_refs, rmse_before, rmse_after, ... }
 *   pacing:           { pace10km_ref_min_km, delta, params, ... }
 *   stats:            { n_races_total, n_races_gpx, timestamp }
 *   plot_rmse_base64: string  PNG grafico in base64 (opzionale)
 *   patch_js:         string  contenuto 4_wiztrail_patch.js (opzionale, per download)
 * }
 *
 * Aggiorna anche hub:authorized_runners se presente nel body (per gestione admin).
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

async function redisKeys(pattern) {
  const res = await fetch(`${UPSTASH_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis KEYS error: ${json.error}`);
  return json.result || [];
}

// Marca tutte le attività pending come calibrated
async function markActivitiesCalibrated() {
  const keys = await redisKeys('hub:activities:*');
  await Promise.all(keys.map(async (k) => {
    const activity = await redisGet(k);
    if (activity && activity.status === 'pending') {
      await redisSet(k, { ...activity, status: 'calibrated' });
    }
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  // Questo endpoint richiede admin token — solo la pipeline può chiamarlo
  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  const ts = new Date().toISOString();

  // Modello corrente
  const model = {
    wdi_calibration: body.wdi_calibration  || null,
    pacing:          body.pacing           || null,
    stats:           body.stats            || null,
    timestamp:       ts,
    patch_js:        body.patch_js         || null,
  };
  await redisSet('hub:model:current', model);

  // Snapshot storico
  await redisSet(`hub:model:history:${ts}`, model);

  // Grafico RMSE
  if (body.plot_rmse_base64) {
    await redisSet('hub:plot:rmse', body.plot_rmse_base64);
  }

  // Aggiorna stats globali
  const prevStats = (await redisGet('hub:stats')) || {};
  const newRmse = body.wdi_calibration?.rmse_after ?? prevStats.last_rmse;
  await redisSet('hub:stats', {
    ...prevStats,
    last_run:         ts,
    last_rmse:        newRmse,
    n_pending:        0,
    pipeline_running: false,
    pipeline_started_at: null,
    pipeline_started_by: null,
  });

  // Marca attività come calibrated
  await markActivitiesCalibrated();

  // Gestione lista runner autorizzati (opzionale, passata dalla pipeline se aggiornata)
  if (Array.isArray(body.authorized_runners)) {
    await redisSet('hub:authorized_runners', body.authorized_runners);
  }

  return res.status(200).json({
    ok:        true,
    timestamp: ts,
    rmse:      newRmse,
  });
}
