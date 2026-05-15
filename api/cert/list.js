/**
 * api/cert/list.js
 * GET /api/cert/list — admin only
 * Returns all certification requests from Redis, sorted desc by date.
 */
import { checkAuth } from '../hub/auth.js';

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

async function redisScan(pattern, maxKeys = 500) {
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
  } while (cursor !== '0' && keys.length < maxKeys);
  return keys;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });

  try {
    const keys = await redisScan('cert:requests:*');
    const all  = await Promise.all(keys.map(k => redisGet(k).catch(() => null)));

    const requests = keys
      .map((k, i) => ({ key: k, data: all[i] }))
      .filter(p => p.data && typeof p.data === 'object' && p.data.race)
      .map(p => ({ id: p.key.replace('cert:requests:', ''), ...p.data }))
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    return res.status(200).json({ ok: true, requests });
  } catch (e) {
    console.error('[cert/list] error:', e);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
}
