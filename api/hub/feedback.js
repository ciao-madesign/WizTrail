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

import { checkRateLimit, getIP } from '../lib/ratelimit.js';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/* Rate limit più basso (10/min) perché endpoint pubblico senza auth.
   Previene flood di dati fittizi che corromperebbero le statistiche. */
const FEEDBACK_RATE_LIMIT = 10;

/* CSRF — origini autorizzate a inviare feedback.
   I browser inviano sempre Origin per POST cross-origin; le richieste
   senza Origin sono same-origin o server-to-server (entrambe OK qui). */
const ALLOWED_ORIGINS = [
  'https://wiz-trail.vercel.app',
  'https://ciao-madesign.github.io',
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin o server-to-server
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return new URL(origin).hostname.endsWith('.vercel.app'); } catch { return false; }
}

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
  const origin = req.headers.origin || '';
  const corsOrigin = isAllowedOrigin(origin) ? (origin || ALLOWED_ORIGINS[0]) : '';
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // CSRF: rifiuta POST da origini non autorizzate (browser invia sempre Origin per cross-origin)
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Origine non autorizzata' });
  }

  /* Rate limiting: 10 richieste/minuto per IP.
     Usa lo stesso Upstash Redis degli altri endpoint. */
  const ip = getIP(req);
  const { allowed, remaining } = await checkRateLimit(ip);
  if (!allowed) {
    res.setHeader('X-RateLimit-Remaining', '0');
    return res.status(429).json({ error: 'Troppe richieste. Riprova tra un minuto.' });
  }
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  const errors = validate(body);
  if (errors.length > 0) return res.status(400).json({ error: 'Dati non validi', details: errors });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /* Salva il singolo feedback con TTL 90 giorni.
     Previene accumulo illimitato su Upstash (GPX fino a 5MB ciascuno). */
  const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 giorni
  const feedbackData = JSON.stringify({
    id,
    delta_pct: body.delta_pct,
    km:        body.km   ?? null,
    dplus:     body.dplus ?? null,
    ts:        new Date().toISOString(),
  });

  /* SET + EXPIRE in pipeline atomica */
  const ttlRes = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['SET', `hub:feedback:${id}`, feedbackData],
      ['EXPIRE', `hub:feedback:${id}`, TTL_SECONDS],
    ])
  });
  const ttlJson = await ttlRes.json();
  if (ttlJson[0]?.error) throw new Error(`Redis SET feedback: ${ttlJson[0].error}`);

  /* Aggiorna statistiche aggregate (per monitoring dashboard) */
  const stats = (await redisGet('hub:feedback:stats')) || { n: 0, sum_delta: 0, last: null };
  await redisSet('hub:feedback:stats', {
    n:         (stats.n         || 0) + 1,
    sum_delta: (stats.sum_delta || 0) + body.delta_pct,
    last:      new Date().toISOString(),
  });

  return res.status(200).json({ ok: true, id });
}
