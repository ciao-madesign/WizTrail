/**
 * api/hub/activities.js
 * GET /api/hub/activities?key=TOKEN&alias=ALIAS
 *
 * Utente normale → restituisce le proprie attività + stats aggregate
 * Admin          → restituisce tutte le attività + stats complete
 */

import { checkAuth } from './auth.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstash(cmd) {
  const res = await fetch(`${UPSTASH_URL}/${cmd}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`Upstash error: ${json.error}`);
  return json.result;
}

async function redisGet(key) {
  const result = await upstash(`get/${encodeURIComponent(key)}`);
  return result ? JSON.parse(result) : null;
}

// Usa SCAN invece di KEYS — supportato da Upstash REST API
async function scanKeys(pattern) {
  const keys = [];
  let cursor = 0;
  do {
    const result = await upstash(`scan/${cursor}?match=${encodeURIComponent(pattern)}&count=100`);
    cursor = parseInt(result[0]);
    keys.push(...result[1]);
  } while (cursor !== 0);
  return keys;
}

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

  try {
    // Carica tutte le chiavi attività tramite SCAN
    const keys = await scanKeys('hub:activities:*');

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

    // Stats aggregate
    const stats = (await redisGet('hub:stats')) || {
      n_total: 0, n_pending: 0, last_run: null, last_rmse: null,
    };

    // Modello corrente
    const model = await redisGet('hub:model:current');

    // Grafico RMSE
    const plot_rmse = await redisGet('hub:plot:rmse');

    // Runner autorizzati (solo admin)
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

  } catch (e) {
    return res.status(500).json({ error: 'Errore lettura Redis: ' + e.message });
  }
}
