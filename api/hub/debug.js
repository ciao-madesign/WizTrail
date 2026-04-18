/**
 * api/hub/debug.js
 * GET /api/hub/debug?key=ADMIN_TOKEN
 * Endpoint temporaneo — elimina dopo il fix
 * Mostra tutte le chiavi Redis e i valori raw
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
  return json;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });

  // Tutte le chiavi
  const keysResult = await cmd(['KEYS', '*']);

  // Valore raw di hub:stats
  const statsRaw = await cmd(['GET', 'hub:stats']);

  // Scan hub:activities:*
  const scanResult = await cmd(['SCAN', '0', 'MATCH', 'hub:activities:*', 'COUNT', '100']);

  return res.status(200).json({
    all_keys:   keysResult,
    stats_raw:  statsRaw,
    scan_activities: scanResult,
  });
}
