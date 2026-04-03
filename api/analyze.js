import "../lib/wdit.js";

export default async function handler(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  const { id } = req.query;

  if (!token || !id) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    // 1️⃣ STREAMS STRAVA
    const url = `https://www.strava.com/api/v3/activities/${id}/streams?keys=latlng,altitude,time,distance&key_by_type=true`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const streams = await response.json();

    // 2️⃣ PREPARAZIONE DATI
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

    // 🔥 3️⃣ WDIT (CORRETTO)
    const result = WizTrailWDIT.computeFromGpx(pts, metrics);

    // 4️⃣ RISPOSTA
    res.status(200).json({
      wdit: result.WDIT,
      label: result.class,
      metrics,
      pts,
      elev
    });

  } catch (err) {
    res.status(500).json({ error: "Analysis failed" });
  }
}