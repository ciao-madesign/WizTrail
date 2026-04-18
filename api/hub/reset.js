/**
 * api/hub/reset.js
 * GET /api/hub/reset?key=ADMIN_TOKEN
 * Endpoint temporaneo — elimina dopo uso
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

function deepParse(val) {
  if (typeof val !== 'string') return val;
  try {
    const parsed = JSON.parse(val);
    if (typeof parsed === 'string') return deepParse(parsed);
    return parsed;
  } catch { return val; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });

  const report = [];

  // Fix hub:stats
  const statsRaw   = await cmd(['GET', 'hub:stats']);
  const statsClean = deepParse(statsRaw);
  const statsFixed = {
    n_total:   statsClean?.n_total   ?? 0,
    n_pending: statsClean?.n_pending ?? 0,
    last_run:  statsClean?.last_run  ?? null,
    last_rmse: statsClean?.last_rmse ?? null,
  };
  await cmd(['SET', 'hub:stats', JSON.stringify(statsFixed)]);
  report.push({ key: 'hub:stats', fixed: statsFixed });

  // Fix hub:activities:*
  const scanResult = await cmd(['SCAN', '0', 'MATCH', 'hub:activities:*', 'COUNT', '100']);
  const actKeys = scanResult[1] || [];

  for (const key of actKeys) {
    const raw   = await cmd(['GET', key]);
    const clean = deepParse(raw);
    if (clean && typeof clean === 'object') {
      await cmd(['SET', key, JSON.stringify(clean)]);
      const { gpx_base64, ...preview } = clean;
      report.push({ key, fixed: preview });
    } else {
      report.push({ key, skipped: true });
    }
  }

  return res.status(200).json({ ok: true, fixed: report.length, report });
}
