/**
 * api/hub/feedback.js
 * POST /api/hub/feedback
 *
 * Raccoglie il feedback anonimo post-gara: solo lo scarto percentuale
 * tra tempo stimato e tempo reale, più distanza e D+ (dati aggregati).
 *
 * PRIVACY: nessun dato personale raccolto.
 * Non richiede autenticazione — endpoint pubblico con rate limit Upstash.
 *
 * Payload atteso:
 *   { delta_pct: number, km: number|null, dplus: number|null, ts: number }
 *
 * Dati salvati in Redis:
 *   hub:feedback:{id} → { delta_pct, km, dplus, ts, id }
 *   hub:feedback:stats → { n: number, sum_delta: number, last: ISO string }
 */

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

function validate(body) {
  const errors = [];
  if (typeof body.delta_pct !== 'number') errors.push('delta_pct deve essere un numero');
  if (Math.abs(body.delta_pct) > 300)    errors.push('delta_pct fuori range (max ±300%)');
  if (body.km != null && (typeof body.km !== 'number' || body.km <= 0 || body.km > 500))
    errors.push('km non valido');
  if (body.dplus != null && (typeof body.dplus !== 'number' || body.dplus < 0 || body.dplus > 30000))
    errors.push('dplus non valido');
  return errors;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  const errors = validate(body);
  if (errors.length > 0) return res.status(400).json({ error: 'Dati non validi', details: errors });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /* Salva il singolo feedback */
  await redisSet(`hub:feedback:${id}`, {
    id,
    delta_pct: body.delta_pct,
    km:        body.km   ?? null,
    dplus:     body.dplus ?? null,
    ts:        new Date().toISOString(),
  });

  /* Aggiorna statistiche aggregate (per monitoring dashboard) */
  const stats = (await redisGet('hub:feedback:stats')) || { n: 0, sum_delta: 0, last: null };
  await redisSet('hub:feedback:stats', {
    n:         (stats.n         || 0) + 1,
    sum_delta: (stats.sum_delta || 0) + body.delta_pct,
    last:      new Date().toISOString(),
  });

  return res.status(200).json({ ok: true, id });
}
