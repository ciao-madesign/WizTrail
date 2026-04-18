/**
 * api/hub/auth.js
 * Verifica token accesso hub. Usato come middleware dagli altri endpoint.
 *
 * Token utente:  HUB_SECRET_TOKEN  → accesso base
 * Token admin:   HUB_ADMIN_TOKEN   → accesso completo + avvio pipeline
 *
 * Uso come middleware:
 *   import { checkAuth } from './auth.js';
 *   const auth = checkAuth(req, res);
 *   if (!auth.ok) return;
 *   if (!auth.isAdmin) return res.status(403).json({ error: 'Solo admin' });
 */

const SECRET = process.env.HUB_SECRET_TOKEN;
const ADMIN  = process.env.HUB_ADMIN_TOKEN;

function extractToken(req) {
  return (
    req.query?.key ||
    req.headers?.['x-hub-key'] ||
    req.body?.key ||
    null
  );
}

/**
 * Middleware riutilizzabile.
 * @returns {{ ok: boolean, isAdmin: boolean }}
 */
function checkAuth(req, res) {
  if (!SECRET || !ADMIN) {
    res.status(500).json({ error: 'Variabili HUB_SECRET_TOKEN / HUB_ADMIN_TOKEN mancanti' });
    return { ok: false, isAdmin: false };
  }

  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: 'Token mancante' });
    return { ok: false, isAdmin: false };
  }

  if (token === ADMIN)  return { ok: true, isAdmin: true };
  if (token === SECRET) return { ok: true, isAdmin: false };

  res.status(401).json({ error: 'Token non valido' });
  return { ok: false, isAdmin: false };
}

export { checkAuth, extractToken };

/**
 * GET /api/hub/auth
 * Chiamato dal frontend all'avvio per verificare il token e ricevere il ruolo.
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req, res);
  if (!auth.ok) return;

  res.status(200).json({ ok: true, isAdmin: auth.isAdmin });
}
