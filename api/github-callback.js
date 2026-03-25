module.exports = async function handler(req, res) {
    const { code } = req.query;

    const errPage = (msg) => {
        res.setHeader('Content-Type', 'text/html');
        return res.send(`<!DOCTYPE html><html><body style="background:#0a0a0a;color:#f87171;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
<div><p style="font-size:1rem;font-weight:600">Connection failed</p><p style="font-size:0.8rem;margin-top:0.5rem;opacity:0.7">${msg}</p></div>
<script>window.opener?.postMessage({type:'clarity-github-error',error:${JSON.stringify(msg)}},'*');setTimeout(()=>window.close(),3000);</script>
</body></html>`);
    };

    if (!code) return errPage('No authorization code received.');

    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
        return errPage('GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set in environment.');
    }

    try {
        // Exchange code for access token
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                client_id:     process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code
            })
        });
        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            return errPage(tokenData.error_description || 'Failed to obtain access token.');
        }

        // Fetch GitHub user profile
        const userRes = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'User-Agent':    'ClarityAI/1.0'
            }
        });
        const user = await userRes.json();

        const payload = JSON.stringify({
            type:  'clarity-github-connected',
            token: tokenData.access_token,
            user:  { login: user.login, avatar_url: user.avatar_url, name: user.name }
        });

        res.setHeader('Content-Type', 'text/html');
        return res.send(`<!DOCTYPE html>
<html>
<head><title>Connecting to GitHub…</title></head>
<body style="background:#0a0a0a;color:white;font-family:ui-sans-serif,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
  <div>
    <svg height="44" viewBox="0 0 16 16" fill="white" style="margin-bottom:1rem">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
    <p style="color:#4ade80;font-weight:600;font-size:1rem">Connected as <strong>${user.login}</strong></p>
    <p style="color:#6b7280;font-size:0.8rem;margin-top:0.5rem">Closing window…</p>
  </div>
  <script>
    try { window.opener.postMessage(${payload}, '*'); } catch(e) {}
    setTimeout(() => window.close(), 900);
  </script>
</body>
</html>`);

    } catch (err) {
        return errPage(err.message || 'Unexpected error during OAuth.');
    }
};
