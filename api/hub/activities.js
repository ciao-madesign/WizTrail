/**
 * api/hub/activities.js
 * GET /api/hub/activities?key=TOKEN&alias=ALIAS
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

function stripGpx(a) { const { gpx_base64, ...rest } = a; return rest; }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;

  const alias = req.query?.alias?.trim() || null;

  try {
    const keys = await scan('hub:activities:*');
    const all  = await Promise.all(keys.map(k => get(k).catch(() => null)));
    const valid = all.filter(Boolean).map(stripGpx);

    const safeSortKey = a => a.timestamp || '';
    const activities = auth.isAdmin
      ? valid.sort((a, b) => safeSortKey(b).localeCompare(safeSortKey(a)))
      : valid.filter(a => a.alias === alias).sort((a, b) => safeSortKey(b).localeCompare(safeSortKey(a)));

    const stats    = (await get('hub:stats')) || { n_total: 0, n_pending: 0, last_run: null, last_rmse: null };
    const model    = await get('hub:model:current');
    const plot_rmse = await get('hub:plot:rmse');
    const authorized_runners = auth.isAdmin ? ((await get('hub:authorized_runners')) || []) : null;

    return res.status(200).json({ ok: true, activities, stats, model, plot_rmse, isAdmin: auth.isAdmin, authorized_runners });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
