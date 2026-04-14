/**
 * api/strava/activities.js — Lista attività Strava dell'atleta
 *
 * GET /api/strava/activities
 * Header richiesto: Authorization: Bearer {strava_token}
 *
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

  // Autenticazione — solo Authorization header, no query param
  const authHeader = req.headers.authorization || '';
  const token      = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }

  // Fetch attività da Strava
  let stravaRes;
  try {
    stravaRes = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=30',
      { headers: { Authorization: 'Bearer ' + token } }
    );
  } catch (err) {
    console.error('activities: fetch error', err.message);
    return res.status(502).json({ error: 'Failed to reach Strava' });
  }

  // Token scaduto o non valido
  if (stravaRes.status === 401) {
    return res.status(401).json({ error: 'Strava token expired or invalid' });
  }

  if (!stravaRes.ok) {
    return res.status(502).json({ error: 'Strava API error' });
  }

  let activities;
  try {
    activities = await stravaRes.json();
  } catch {
    return res.status(502).json({ error: 'Invalid response from Strava' });
  }

  if (!Array.isArray(activities)) {
    return res.status(502).json({ error: 'Unexpected response format' });
  }

  // Restituisce solo i campi necessari al frontend
  const slim = activities.map(a => ({
    id:                    a.id,
    name:                  a.name,
    distance:              a.distance,
    total_elevation_gain:  a.total_elevation_gain,
    moving_time:           a.moving_time,
    sport_type:            a.sport_type
  }));

  return res.status(200).json(slim);
}
