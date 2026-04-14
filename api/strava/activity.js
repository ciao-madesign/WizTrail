/**
 * api/strava/activity.js — Singola attività Strava
 *
 * GET /api/strava/activity?id={activityId}
 *   → restituisce raw streams (latlng, altitude, distance, time)
 *
 * GET /api/strava/activity?id={activityId}&mode=analyze
 *   → restituisce pts[], metrics{}, movingTime
 *     (usato da training-analyzer.html)
 *
 * Header richiesto: Authorization: Bearer {strava_token}
 * Rate limit: 30 req/min per IP (Upstash)
 */

import { checkRateLimit, getIP } from '../lib/ratelimit.js';

export default async function handler(req, res) {

  // Solo GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const ip     = getIP(req);
  const { allowed, remaining } = await checkRateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', remaining);

  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Autenticazione
  const authHeader = req.headers.authorization || '';
  const token      = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }

  // Validazione ?id= — solo numeri interi, max 20 cifre
  const { id, mode } = req.query;
  if (!id || !/^\d{1,20}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid or missing activity id' });
  }

  // Fetch streams da Strava
  let streamsRes;
  try {
    streamsRes = await fetch(
      'https://www.strava.com/api/v3/activities/' + id +
      '/streams?keys=latlng,altitude,time,distance&key_by_type=true',
      { headers: { Authorization: 'Bearer ' + token } }
    );
  } catch (err) {
    console.error('activity: streams fetch error', err.message);
    return res.status(502).json({ error: 'Failed to reach Strava' });
  }

  if (streamsRes.status === 401) {
    return res.status(401).json({ error: 'Strava token expired or invalid' });
  }
  if (streamsRes.status === 404) {
    return res.status(404).json({ error: 'Activity not found' });
  }
  if (!streamsRes.ok) {
    return res.status(502).json({ error: 'Strava API error' });
  }

  let streams;
  try {
    streams = await streamsRes.json();
  } catch {
    return res.status(502).json({ error: 'Invalid response from Strava' });
  }

  // Verifica dati minimi presenti
  if (!streams || !streams.latlng || !streams.altitude || !streams.distance) {
    return res.status(422).json({ error: 'Activity has incomplete stream data' });
  }

  // MODE: raw — restituisce streams come arrivano da Strava
  if (mode !== 'analyze') {
    return res.status(200).json(streams);
  }

  // MODE: analyze — calcola pts[] e metrics{}
  const latlng   = streams.latlng.data;
  const elev     = streams.altitude.data;
  const dist     = streams.distance.data;

  if (!latlng.length || latlng.length !== elev.length) {
    return res.status(422).json({ error: 'Stream length mismatch' });
  }

  const pts = latlng.map(function (p, i) {
    return [p[0], p[1], elev[i]];
  });

  let gain = 0;
  for (let i = 1; i < elev.length; i++) {
    const delta = elev[i] - elev[i - 1];
    if (delta > 0) gain += delta;
  }

  const metrics = {
    km:   dist[dist.length - 1] / 1000,
    gain: Math.round(gain),
    e:    elev,
    d:    dist
  };

  // Fetch moving_time dall'endpoint attività (richiede chiamata separata)
  let movingTime = null;
  try {
    const actRes = await fetch(
      'https://www.strava.com/api/v3/activities/' + id,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (actRes.ok) {
      const act = await actRes.json();
      movingTime = act.moving_time || null;
    }
  } catch (err) {
    // Non fatale — movingTime resta null
    console.error('activity: moving_time fetch error', err.message);
  }

  return res.status(200).json({ pts, metrics, movingTime });
}
