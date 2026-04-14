/**
 * api/strava/callback.js — WizTrail Strava OAuth Callback
 * Riceve ?code= dal browser, scambia con Strava server-side.
 * Il client_secret non lascia mai il server.
 *
 * Env vars richieste su Vercel:
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 */

export default async function handler(req, res) {
  // Solo GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validazione ?code= — alfanumerico, max 100 chars
  const { code } = req.query;
  if (!code || !/^[a-zA-Z0-9_\-]{1,100}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid or missing code' });
  }

  // Env vars
  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Scambio code → token con Strava
  let stravaRes;
  try {
    stravaRes = await fetch('https://www.strava.com/api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code'
      })
    });
  } catch (err) {
    console.error('Strava fetch error:', err.message);
    return res.status(502).json({ error: 'Failed to reach Strava' });
  }

  let data;
  try {
    data = await stravaRes.json();
  } catch {
    return res.status(502).json({ error: 'Invalid response from Strava' });
  }

  if (!stravaRes.ok || !data.access_token) {
    // Non esporre il messaggio di errore Strava al client
    console.error('Strava token exchange failed:', data);
    return res.status(401).json({ error: 'Authentication failed' });
  }

  // Restituisce solo access_token e athlete.id (non refresh_token, non dati sensibili)
  return res.status(200).json({
    access_token: data.access_token,
    athlete_id:   data.athlete?.id ?? null,
    expires_at:   data.expires_at  ?? null
  });
}