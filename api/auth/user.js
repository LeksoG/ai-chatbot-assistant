function getUserFromToken(req) {
    try {
        const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        if (!raw) return null;
        const parts = raw.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        if (!payload.sub) return null;
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return { id: payload.sub, email: payload.email || '' };
    } catch { return null; }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const authUser = getUserFromToken(req);
    if (!authUser) return res.status(401).json({ error: 'Unauthorized or session expired' });

    const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        if (req.method === 'GET') {
            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=*`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            return res.json(Array.isArray(data) ? data[0] : null);
        }

        if (req.method === 'PATCH') {
            const { firstName, lastName, two_fa_enabled, currentPassword, newPassword, email } = req.body || {};

            const profileUpdates = {};
            if (firstName     !== undefined) profileUpdates.first_name     = firstName;
            if (lastName      !== undefined) profileUpdates.last_name      = lastName;
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
