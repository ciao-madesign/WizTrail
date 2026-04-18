/**
 * api/hub/patch.js
 * POST /api/hub/patch
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

async function scan(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const r = await cmd(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '100']);
    cursor = r[0];
    keys.push(...r[1]);
  } while (cursor !== '0');
  return keys;
}

async function markActivitiesCalibrated() {
  const keys = await scan('hub:activities:*');
  await Promise.all(keys.map(async (k) => {
    const activity = await get(k);
    if (activity?.status === 'pending') {
      await set(k, { ...activity, status: 'calibrated' });
    }
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

  const ts = new Date().toISOString();

  const model = {
    wdi_calibration: body.wdi_calibration || null,
    pacing:          body.pacing          || null,
    stats:           body.stats           || null,
    timestamp:       ts,
    patch_js:        body.patch_js        || null,
  };
  await set('hub:model:current', model);
  await set(`hub:model:history:${ts}`, model);

  if (body.plot_rmse_base64) await set('hub:plot:rmse', body.plot_rmse_base64);

  const prevStats = (await get('hub:stats')) || {};
  const newRmse   = body.wdi_calibration?.rmse_after ?? prevStats.last_rmse;
  await set('hub:stats', {
    ...prevStats,
    last_run: ts, last_rmse: newRmse, n_pending: 0,
    pipeline_running: false, pipeline_started_at: null, pipeline_started_by: null,
  });

  await markActivitiesCalibrated();

  if (Array.isArray(body.authorized_runners)) {
    await set('hub:authorized_runners', body.authorized_runners);
  }

  return res.status(200).json({ ok: true, timestamp: ts, rmse: newRmse });
}
