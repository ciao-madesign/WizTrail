export default async function handler(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  const { id } = req.query;

  if (!token || !id) {
    return res.status(400).json({ error: "Missing data" });
  }

  const url = `https://www.strava.com/api/v3/activities/${id}/streams?keys=latlng,altitude,time,distance&key_by_type=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();
  res.status(200).json(data);
}
