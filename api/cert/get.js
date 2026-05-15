/**
 * api/cert/get.js
 * GET /api/cert/get?id={id} — public
 * Returns a certified race. 404 if not found or not approved.
 * Email is stripped from the public response.
 */

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id obbligatorio' });

  const key    = `cert:requests:${id}`;
  const getRes = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const json = await getRes.json();

  if (!json.result) return res.status(404).json({ error: 'Gara non trovata' });

  let race;
  try { race = JSON.parse(json.result); } catch {
    return res.status(500).json({ error: 'Dati corrotti' });
  }

  if (race.status !== 'approved') return res.status(404).json({ error: 'Gara non certificata' });

  // Strip email from public response
  const { email, ...publicData } = race;

  return res.status(200).json({ ok: true, race: publicData });
}
