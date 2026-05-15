/**
 * api/import/url.js — Proxy fetch GPX da URL esterno
 *
 * GET /api/import/url?url=ENCODED_URL
 *
 * Necessario perché il browser non può fare fetch cross-origin arbitrari.
 * Blocca: IP privati, schemi non-http/https, file >5MB, content-type non GPX/XML.
 */

import { checkRateLimit, getIP } from '../lib/ratelimit.js';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// Blocca hostname privati/locali e metadata endpoint cloud
function isPrivateHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||   // link-local: AWS/Azure/GCP metadata
    /^::1$/.test(hostname) ||
    /^fe80:/i.test(hostname) ||       // IPv6 link-local
    /^fd/i.test(hostname)             // IPv6 ULA
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIP(req);
  const { allowed, remaining } = await checkRateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', remaining);
  if (!allowed) return res.status(429).json({ error: 'Too many requests' });

  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'Parametro url mancante' });

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'URL non valido' });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Solo URL http/https consentiti' });
  }

  if (isPrivateHost(parsed.hostname)) {
    return res.status(400).json({ error: 'URL non raggiungibile' });
  }

  let upstream;
  try {
    upstream = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'WizTrail/1.0' },
      redirect: 'follow',
    });
  } catch {
    return res.status(502).json({ error: 'Impossibile raggiungere l\'URL' });
  }

  if (!upstream.ok) {
    return res.status(502).json({ error: 'Risposta non valida dall\'URL (' + upstream.status + ')' });
  }

  const ct = upstream.headers.get('content-type') || '';
  const isXml = ct.includes('xml') || ct.includes('gpx') || ct.includes('octet-stream') || ct.includes('text/plain');
  if (!isXml) {
    return res.status(422).json({ error: 'Il file non sembra un GPX/XML (content-type: ' + ct + ')' });
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_SIZE) {
    return res.status(413).json({ error: 'File troppo grande (max 5 MB)' });
  }

  const text = new TextDecoder().decode(buf);
  if (!text.includes('<gpx') && !text.includes('<trk') && !text.includes('<rte') && !text.includes('<TrainingCenterDatabase')) {
    return res.status(422).json({ error: 'Il file non contiene una traccia GPX/TCX valida' });
  }

  res.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
  res.status(200).send(text);
}
