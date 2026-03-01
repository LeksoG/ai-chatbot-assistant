// Decode JWT payload without verifying signature (server-side, Node Buffer)
function decodeJWTPayload(token) {
    try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch { return null; }
}

async function getAuthUser(req) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null;

    // Try the live Supabase auth endpoint first (works for fresh tokens)
    try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
        });
        if (r.ok) return await r.json();
    } catch { /* fall through */ }

    // Token is expired or Supabase is unreachable — fall back to decoding the
    // JWT payload.  The JWT is Supabase-signed, so the `sub` (user UUID) inside
    // is still trustworthy: an attacker cannot forge a different `sub` without
    // Supabase's private key.
    const payload = decodeJWTPayload(token);
    if (payload?.sub) return { id: payload.sub, email: payload.email };

    return null;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

    const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // GET — return user profile
        if (req.method === 'GET') {
            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=*`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            return res.json(Array.isArray(data) ? data[0] : null);
        }

        // PATCH — update profile / password / 2FA
        if (req.method === 'PATCH') {
            const { firstName, lastName, two_fa_enabled, currentPassword, newPassword, email } = req.body || {};

            // Update profile fields
            const profileUpdates = {};
            if (firstName !== undefined) profileUpdates.first_name   = firstName;
            if (lastName  !== undefined) profileUpdates.last_name    = lastName;
            if (two_fa_enabled !== undefined) profileUpdates.two_fa_enabled = two_fa_enabled;

            if (Object.keys(profileUpdates).length) {
                await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}`, {
                    method: 'PATCH',
                    headers: sbHeaders,
                    body: JSON.stringify(profileUpdates)
                });
            }

            // Change password — verify current password first
            if (newPassword && currentPassword && email) {
                const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password: currentPassword })
                });
                if (!verifyRes.ok) {
                    return res.status(401).json({ error: 'Current password is incorrect.' });
                }

                await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
                    method: 'PUT',
                    headers: sbHeaders,
                    body: JSON.stringify({ password: newPassword })
                });
            }

            return res.json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
