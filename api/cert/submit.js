/**
 * api/cert/submit.js
 * POST /api/cert/submit  — public, no auth required
 * Saves a certification request in Redis under cert:requests:{timestamp}
 */

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, JSON.stringify(value)]])
  });
  const json = await res.json();
  if (json[0]?.error) throw new Error(`Redis SET: ${json[0].error}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body?.race || !body?.email) {
    return res.status(400).json({ error: 'race e email sono obbligatori' });
  }

  // Basic email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return res.status(400).json({ error: 'Email non valida' });
  }

  const ts = new Date().toISOString();
  const request = {
    race:      String(body.race).slice(0, 200),
    organizer: String(body.organizer || '').slice(0, 200),
    email:     String(body.email).slice(0, 200),
    edition:   String(body.edition || '').slice(0, 20),
    notes:     String(body.notes || '').slice(0, 1000),
    km:        typeof body.km === 'number' ? body.km : null,
    dplus:     typeof body.dplus === 'number' ? body.dplus : null,
    wdi:       typeof body.wdi === 'number' ? body.wdi : null,
    tech:      typeof body.tech === 'number' ? body.tech : null,
    wdicat:    body.wdicat || null,
    status:    'pending',
    timestamp: ts,
  };

  await redisSet(`cert:requests:${ts}`, request);

  return res.status(200).json({ ok: true, id: ts });
}
