/**
 * api/lib/auth.js — Autenticazione centralizzata per le API pubbliche v1.
 *
 * Controlla x-api-key contro:
 *   1. Variabile d'ambiente API_KEYS (comma-separated) — chiavi statiche
 *   2. Redis — chiavi registrate dinamicamente via hub?action=register
 *
 * Fail-open su errore Redis (non blocca il servizio per infra down).
 */

const REDIS_NS = 'wiztrail:';

async function redisGetRaw(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res  = await fetch(`${url}/get/${encodeURIComponent(REDIS_NS + key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (json.result === null) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

/**
 * Verifica se la richiesta porta una x-api-key valida.
 * @param {import('@vercel/node').VercelRequest} req
 * @returns {Promise<boolean>}
 */
export async function checkApiKey(req) {
  const provided = (req.headers['x-api-key'] || '').trim();
  if (!provided) return false;

  // 1. Chiavi statiche da env var (non richiede Redis)
  const envKeys = (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (envKeys.includes(provided)) return true;

  // 2. Chiavi dinamiche registrate su Redis
  try {
    const data = await redisGetRaw(`apikeys:${provided}`);
    return data !== null && data.active === true;
  } catch {
    // Fail-open: se Redis non risponde le chiavi dinamiche sembrano invalide,
    // ma non blocchiamo le chiavi statiche (già controllate sopra).
    return false;
  }
}
