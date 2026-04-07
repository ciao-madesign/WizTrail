export default async function handler(req, res) {

  const token =
    req.headers.authorization?.split(" ")[1] ||
    req.query.token;

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const response = await fetch(
      "https://www.strava.com/api/v3/athlete/activities?per_page=30",
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    console.log("STRAVA RESPONSE:", data);

    res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}