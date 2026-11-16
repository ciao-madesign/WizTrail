/**
 * server/ratelimit.js — Rate limiting condiviso via Upstash Redis
 *
 * Usa l'API REST di Upstash direttamente (no SDK).
 *
 * Strategia: finestra fissa. INCR + EXPIRE ... NX: il TTL viene impostato solo alla
 * prima richiesta della finestra e NON viene rinnovato dalle successive (prima ogni
 * richiesta rinnovava il TTL e il blocco non scadeva mai finche' si continuava a chiamare).
 * Contatori separati per endpoint (scope) con limiti propri.
 * Key naming: wiztrail:ratelimit:<scope>:<ip>
 *
 * Fail-open: se Redis non e' configurato o non risponde non si blocca il servizio
 * (viene loggato l'errore).
 *
 * Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

const WINDOW_SECONDS = 60;
const MAX_REQUESTS   = 30;
const REDIS_NS       = 'wiztrail:'; // namespace per isolare da altri progetti sullo stesso DB

/** Limiti richieste/minuto per endpoint. */
export const LIMITI = { default: 30, import: 10, strava: 30, v1: 30, feedback: 5 };

/**
 * Controlla il rate limit per un dato IP e scope.
 * @param {string} ip
 * @param {string} [scope='default']  endpoint logico (import, strava, v1, feedback...)
 * @param {number} [max]              limite per finestra (default da LIMITI[scope])
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfter: number }>}
 */
export async function checkRateLimit(ip, scope = 'default', max = LIMITI[scope] ?? MAX_REQUESTS) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error('ratelimit: UPSTASH env vars missing');
    return { allowed: true, remaining: max, retryAfter: 0 };
  }

  const key = REDIS_NS + 'ratelimit:' + scope + ':' + ip;
  const hdr = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  try {
    // INCR + EXPIRE NX in una sola chiamata HTTP: il TTL si imposta una volta sola per finestra
    const res = await fetch(url + '/pipeline', {
      method:  'POST',
      headers: hdr,
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, WINDOW_SECONDS, 'NX']
      ])
    });

    if (!res.ok) {
      console.error('ratelimit: Upstash HTTP error', res.status);
      return { allowed: true, remaining: max, retryAfter: 0 };
    }

    const data  = await res.json();
    const count = data[0]?.result ?? 1;

    // Fallback per istanze Redis < 7 che non supportano EXPIRE NX: TTL solo alla prima richiesta
    if (data[1]?.error && count === 1) {
      await fetch(url + '/pipeline', {
        method: 'POST', headers: hdr,
        body: JSON.stringify([['EXPIRE', key, WINDOW_SECONDS]])
      });
    }

    const allowed   = count <= max;
    const remaining = Math.max(0, max - count);
    return { allowed, remaining, retryAfter: allowed ? 0 : WINDOW_SECONDS };

  } catch (err) {
    console.error('ratelimit: fetch error', err.message);
    return { allowed: true, remaining: max, retryAfter: 0 };
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
