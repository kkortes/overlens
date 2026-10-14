// The one server-side moment in Overlens: swapping the OAuth code — or the
// refresh token, once the 8-hour user access token expires — for a user
// access token needs the GitHub App's client secret. Everything else happens
// in the browser.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { code, refresh_token } = req.body ?? {};
  if (!code && !refresh_token) return res.status(400).json({ error: 'missing code or refresh_token' });

  const upstream = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      ...(code ? { code } : { grant_type: 'refresh_token', refresh_token }),
    }),
  });
  const data = await upstream.json();

  if (!upstream.ok || data.error)
    return res.status(502).json({ error: data.error_description || data.error || `GitHub answered ${upstream.status}` });
  const { access_token, refresh_token: refresh, expires_in } = data;
  res.status(200).json({ access_token, refresh_token: refresh, expires_in });
}
