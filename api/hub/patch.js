/**
 * api/hub/patch.js
 * POST /api/hub/patch
 */
import { checkAuth } from './auth.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis GET: ${json.error}`);
  if (json.result === null) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
  const json = await res.json();
  if (json[0]?.error) throw new Error(`Redis SET: ${json[0].error}`);
  return json[0]?.result;
}

async function redisScan(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const res = await fetch(
      `${UPSTASH_URL}/scan/${cursor}?match=${encodeURIComponent(pattern)}&count=100`,
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }
    );
    const json = await res.json();
    if (json.error) throw new Error(`Redis SCAN: ${json.error}`);
    cursor = json.result[0];
    keys.push(...json.result[1]);
  } while (cursor !== '0');
  return keys;
}

async function markActivitiesCalibrated() {
  const keys = await redisScan('hub:activities:*');
  await Promise.all(keys.map(async k => {
    const a = await redisGet(k);
    if (a?.status === 'pending') await redisSet(k, { ...a, status: 'calibrated' });
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  // Reset manuale del flag pipeline (dal pulsante admin nell'hub)
  if (body._reset_pipeline) {
    const s = (await redisGet('hub:stats')) || {};
    await redisSet('hub:stats', { ...s, pipeline_running: false, pipeline_started_at: null, pipeline_started_by: null });
    return res.status(200).json({ ok: true, action: 'pipeline_reset' });
  }

  const ts = new Date().toISOString();

  // Salva modello corrente
  const model = {
    wdi_calibration: body.wdi_calibration || null,
    timing:          body.timing          || null,
    pacing:          body.timing          || body.pacing || null,  // retrocompatibilità
    stats:           body.stats           || null,
    timestamp:       ts,
    patch_js:        body.patch_js        || null,
  };
  await redisSet('hub:model:current', model);
  await redisSet(`hub:model:history:${ts}`, model);

  // Salva grafico RMSE principale (retrocompatibilità)
  if (body.plot_rmse_base64) await redisSet('hub:plot:rmse', body.plot_rmse_base64);

  // Salva tutti i grafici
  if (body.plots && typeof body.plots === 'object') {
    for (const [name, b64] of Object.entries(body.plots)) {
      await redisSet(`hub:plot:${name}`, b64);
    }
  }

  // Salva report markdown
  if (body.report_md) await redisSet('hub:report:md', body.report_md);

  // Aggiorna stats — pipeline_running: false
  const prevStats = (await redisGet('hub:stats')) || {};
  const newRmse   = body.wdi_calibration?.rmse_after ?? prevStats.last_rmse;
  await redisSet('hub:stats', {
    n_total:             prevStats.n_total   || 0,
    n_pending:           0,
    last_run:            ts,
    last_rmse:           newRmse,
    pipeline_running:    false,
    pipeline_started_at: null,
    pipeline_started_by: null,
  });

  // Marca attività calibrated
  await markActivitiesCalibrated();

  // Aggiorna runner autorizzati se presenti
  if (Array.isArray(body.authorized_runners)) {
    await redisSet('hub:authorized_runners', body.authorized_runners);
  }

  return res.status(200).json({ ok: true, timestamp: ts, rmse: newRmse });
}
