/**
 * server/features.js — Feature flag lato server.
 *
 * STRAVA_ENABLED=true riattiva l'integrazione Strava (default: spenta,
 * abbonamento sviluppatore non attivo). Il codice Strava resta nel repo.
 */

export function stravaAbilitata() {
  return process.env.STRAVA_ENABLED === 'true';
}

/**
 * Se Strava e' spenta risponde 503 con messaggio italiano e ritorna true
 * (l'handler deve fermarsi). Va chiamata PRIMA di rate limit e di ogni fetch a Strava.
 */
export function rispondiSeStravaSpenta(res) {
  if (stravaAbilitata()) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({
    ok: false,
    code: 'FEATURE_UNAVAILABLE',
    feature: 'strava',
    error: "L'integrazione con Strava non è ancora disponibile. Nel frattempo puoi caricare il file GPX o TCX della tua attività.",
  });
  return true;
}
