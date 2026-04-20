/**
 * api/hub/cleanup.js
 * GET /api/hub/cleanup?key=ADMIN_TOKEN
 * Endpoint temporaneo — elimina dopo uso
 * Rimuove attività corrotte (senza name o km validi)
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
    const p = JSON.parse(val);
    if (typeof p === 'string') return deepParse(p);
    return p;
  } catch { return val; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const auth = checkAuth(req, res);
  if (!auth.ok) return;
  if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });

  const scanResult = await cmd(['SCAN', '0', 'MATCH', 'hub:activities:*', 'COUNT', '100']);
  const keys = scanResult[1] || [];

  const deleted = [];
  const kept    = [];

  for (const key of keys) {
    const raw  = await cmd(['GET', key]);
    const data = deepParse(raw);

    // Attività valida: ha name, km numerico e timestamp
    const isValid = data &&
      typeof data === 'object' &&
      data.name &&
      typeof data.km === 'number' &&
      data.km > 0 &&
      data.timestamp;

    if (isValid) {
      kept.push({ key, name: data.name, km: data.km });
    } else {
      await cmd(['DEL', key]);
      deleted.push({ key, data: typeof data === 'object' ? data : String(raw).slice(0, 80) });
    }
  }

  // Aggiorna stats
  const statsRaw  = await cmd(['GET', 'hub:stats']);
  const stats     = deepParse(statsRaw) || {};
  const newTotal   = kept.length;
  const newPending = kept.filter(k => {
    // rileva pending dal dato originale — semplificato
    return true;
  }).length;
  await cmd(['SET', 'hub:stats', JSON.stringify({
    ...stats,
    n_total:   newTotal,
    n_pending: newTotal, // verrà ricalcolato al prossimo upload
  })]);

  return res.status(200).json({
    ok: true,
    deleted: deleted.length,
    kept: kept.length,
    deleted_keys: deleted,
    kept_keys: kept,
  });
}
