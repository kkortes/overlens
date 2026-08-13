// The one server-side moment in Overlens: swapping the OAuth code for a user
// access token needs the GitHub App's client secret. Everything else happens
// in the browser.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: 'missing code' });

  const upstream = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await upstream.json();

  if (!upstream.ok || data.error)
    return res.status(502).json({ error: data.error_description || data.error || `GitHub answered ${upstream.status}` });
  res.status(200).json({ access_token: data.access_token });
}
