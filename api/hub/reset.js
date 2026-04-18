/**
 * api/hub/reset.js
 * POST /api/hub/reset?key=ADMIN_TOKEN
 * Endpoint temporaneo — elimina dopo uso
 * Pulisce Redis da dati corrotti e riscrive correttamente
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
  if (json.error) throw new Error(json.error);
  return json.result;
}

// Deserializza ricorsivamente finché non è un oggetto
function deepParse(val) {
  if (typeof val !== 'string') return val;
  try {
    const parsed = JSON.parse(val);
    if (typeof parsed === 'string') return deepParse(parsed);
    return parsed;
  } catch {
    return val;
  }
}

async function getRaw(key) {
  return cmd(['GET', key]);
}

async function setClean(key, value) {
  return cmd(['SET', key, JSON.stringify(value)]);
}

async function delKey(key) {
  return cmd(['DEL', key]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });

  const report = [];

  // 1. Fix hub:stats
  const statsRaw = await getRaw('hub:stats');
  const statsClean = deepParse(statsRaw);
  await setClean('hub:stats', {
    n_total:   statsClean?.n_total   ?? 0,
    n_pending: statsClean?.n_pending ?? 0,
    last_run:  statsClean?.last_run  ?? null,
    last_rmse: statsClean?.last_rmse ?? null,
  });
  report.push({ key: 'hub:stats', action: 'cleaned', value: statsClean });

  // 2. Fix hub:activities:*
  const scanResult = await cmd(['SCAN', '0', 'MATCH', 'hub:activities:*', 'COUNT', '100']);
  const actKeys = scanResult[1] || [];

  for (const key of actKeys) {
    const raw   = await getRaw(key);
    const clean = deepParse(raw);
    if (clean && typeof clean === 'object') {
      // Rimuovi gpx_base64 dal report ma mantienilo nel dato
      await setClean(key, clean);
      const { gpx_base64, ...preview } = clean;
      report.push({ key, action: 'cleaned', value: preview });
    } else {
      report.push({ key, action: 'skipped', raw: String(raw).slice(0, 100) });
    }
  }

  return res.status(200).json({ ok: true, fixed: report.length, report });
}
