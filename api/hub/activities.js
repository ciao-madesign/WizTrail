/**
 * api/hub/activities.js
 * GET /api/hub/activities?key=TOKEN&alias=ALIAS
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

function stripGpx(a) {
  const { gpx_base64, ...rest } = a;
  return rest;
}

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
    const keys  = await redisScan('hub:activities:*');
    const all   = await Promise.all(keys.map(k => redisGet(k).catch(() => null)));
    const valid = all.filter(a => a && typeof a === 'object' && a.name).map(stripGpx);

    const activities = auth.isAdmin
      ? valid.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      : valid
          .filter(a => a.alias === alias)
          .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    const stats     = (await redisGet('hub:stats')) || { n_total: 0, n_pending: 0, last_run: null, last_rmse: null };
    const model     = await redisGet('hub:model:current');
    const plot_rmse = await redisGet('hub:plot:rmse');

    const plotNames = ['wdi_scatter','pacing_scatter','insights_distribution',
                       'insights_tech_vs_wdi','insights_spread','history_rmse'];
    const plots = {};
    await Promise.all(plotNames.map(async name => {
      const b = await redisGet(`hub:plot:${name}`).catch(() => null);
      if (b) plots[name] = b;
    }));

    const report_md          = await redisGet('hub:report:md').catch(() => null);
    const authorized_runners = auth.isAdmin ? ((await redisGet('hub:authorized_runners')) || []) : null;

    return res.status(200).json({
      ok: true, activities, stats, model, plot_rmse,
      plots, report_md, isAdmin: auth.isAdmin, authorized_runners
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
