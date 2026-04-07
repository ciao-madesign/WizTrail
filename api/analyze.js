export default async function handler(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  const { id } = req.query;

  if (!token || !id) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    const url = `https://www.strava.com/api/v3/activities/${id}/streams?keys=latlng,altitude,time,distance&key_by_type=true`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const streams = await response.json();

    // 🔥 FIX CRITICO
    if (!streams || Object.keys(streams).length === 0) {
      return res.status(400).json({
        error: "Attività senza dati (Strava non restituisce streams)"
      });
    }

    if (
      !streams.latlng ||
      !streams.altitude ||
      !streams.distance
    ) {
      return res.status(400).json({
        error: "Attività non supportata (dati incompleti)"
      });
    }

    const elev = streams.altitude.data;
    const dist = streams.distance.data;

    const pts = streams.latlng.data.map((p, i) => [
      p[0],
      p[1],
      elev[i]
    ]);

    const gain = elev.reduce((s, v, i) =>
      i > 0 ? s + Math.max(0, v - elev[i - 1]) : 0
    , 0);

    const metrics = {
      km: dist.at(-1) / 1000,
      gain,
      e: elev,
      d: dist
    };

// 🔥 PRENDI DATI ATTIVITÀ (TEMPO)
const activityRes = await fetch(
  `https://www.strava.com/api/v3/activities/${id}`,
  {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }
);

const activity = await activityRes.json();

// tempo in secondi
const movingTime = activity.moving_time || null;


   res.status(200).json({
  metrics,
  pts,
  elev,
movingTime
});

  } catch (err) {
    console.error("ANALYZE ERROR:", err);
    res.status(500).json({ error: "Errore analisi attività" });
  }
}