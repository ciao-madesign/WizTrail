/**
 * api/lib/ratelimit.js — Rate limiting condiviso via Upstash Redis
 *
 * Usa l'API REST di Upstash direttamente (no SDK) per massima
 * compatibilità con Vercel Edge e Node runtime.
 *
 * Strategia: sliding window, 30 richieste/minuto per IP.
 * Key naming: ratelimit:ip:{ip}
 *
 * Env vars richieste:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

const WINDOW_SECONDS = 60;
const MAX_REQUESTS   = 30;

/**
 * Controlla il rate limit per un dato IP.
 * @param {string} ip
 * @returns {Promise<{ allowed: boolean, remaining: number }>}
 */
export async function checkRateLimit(ip) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Se le env vars mancano, lascia passare (fail-open)
  // e logga l'errore — non bloccare il servizio per config mancante
  if (!url || !token) {
    console.error('ratelimit: UPSTASH env vars missing');
    return { allowed: true, remaining: MAX_REQUESTS };
  }

  const key = 'ratelimit:ip:' + ip;

  try {
    // Pipeline: INCR + EXPIRE in una sola chiamata HTTP
    const res = await fetch(url + '/pipeline', {
      method:  'POST',
      headers: {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, WINDOW_SECONDS]
      ])
    });

    if (!res.ok) {
      console.error('ratelimit: Upstash HTTP error', res.status);
      return { allowed: true, remaining: MAX_REQUESTS };
    }

    const data    = await res.json();
    const count   = data[0]?.result ?? 1;
    const allowed = count <= MAX_REQUESTS;
    const remaining = Math.max(0, MAX_REQUESTS - count);

    return { allowed, remaining };

  } catch (err) {
    console.error('ratelimit: fetch error', err.message);
    return { allowed: true, remaining: MAX_REQUESTS };
  }
}

/**
 * Legge l'IP reale dalla request Vercel.
 * @param {import('@vercel/node').VercelRequest} req
 * @returns {string}
 */
export function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
