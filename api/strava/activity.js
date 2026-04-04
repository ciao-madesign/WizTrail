export default async function handler(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  const { id } = req.query;

  // Controlli base
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  if (!id) {
    return res.status(400).json({ error: "Missing activity id" });
  }

  try {
    // 🔥 Chiamata a Strava per streams completi
    const url = `https://www.strava.com/api/v3/activities/${id}/streams?keys=latlng,altitude,time,distance&key_by_type=true`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Strava API error"
      });
    }

    const data = await response.json();

    // Controllo sicurezza dati
    if (!data.latlng || !data.altitude || !data.distance) {
      return res.status(400).json({
        error: "Incomplete stream data"
      });
    }

    // ✅ Risposta pulita
    res.status(200).json(data);

  } catch (err) {
    console.error("ACTIVITY ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
}