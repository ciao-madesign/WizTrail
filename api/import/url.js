/**
 * api/import/url.js — Proxy fetch GPX da URL esterno
 *
 * GET /api/import/url?url=ENCODED_URL
 *
 * Necessario perché il browser non può fare fetch cross-origin arbitrari.
 * Protezione SSRF in server/netguard.js: host/IP v4+v6 non pubblici bloccati,
 * DNS risolto e validato (anti rebinding), redirect manuali max 3, timeout 8 s,
 * tetto di 5 MB in streaming. Errori sempre JSON { ok:false, code, error } in italiano.
 */

import { checkRateLimit, getIP } from '../../server/ratelimit.js';
import { scaricaSicuro, ErroreImport } from '../../server/netguard.js';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function errore(res, status, code, messaggio) {
  return res.status(status).json({ ok: false, code, error: messaggio });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return errore(res, 405, 'METHOD_NOT_ALLOWED', 'Metodo non consentito.');

  const ip = getIP(req);
  const { allowed, remaining } = await checkRateLimit(ip, 'import');
  res.setHeader('X-RateLimit-Remaining', remaining);
  if (!allowed) {
    res.setHeader('Retry-After', '60');
    return errore(res, 429, 'RATE_LIMITED', 'Troppe richieste. Riprova tra un minuto.');
  }

  const raw = req.query.url;
  if (!raw) return errore(res, 400, 'MISSING_URL', 'Parametro url mancante.');

  let esito;
  try {
    esito = await scaricaSicuro(String(raw), { maxBytes: MAX_SIZE, timeoutMs: 8000, maxRedirect: 3 });
  } catch (e) {
    if (e instanceof ErroreImport) return errore(res, e.status, e.code, e.message);
    console.error('import/url: errore inatteso', e && e.message);
    return errore(res, 502, 'UPSTREAM_UNREACHABLE', "Impossibile raggiungere l'indirizzo indicato.");
  }

  const text = esito.buffer.toString('utf-8');
  if (!text.includes('<gpx') && !text.includes('<trk') && !text.includes('<rte') && !text.includes('<TrainingCenterDatabase')) {
    return errore(res, 422, 'NOT_GPX', 'Il file non contiene una traccia GPX/TCX valida.');
  }

  res.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
  res.status(200).send(text);
}
