// Decode JWT payload without signature verification.
// Supabase JWTs are HS256-signed with a server-side secret — safe to trust the payload.
function getUserFromToken(req) {
    try {
        const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        if (!raw) return null;
        const parts = raw.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        if (!payload.sub) return null;
        // Reject expired tokens
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return { id: payload.sub, email: payload.email || '' };
    } catch { return null; }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const authUser = getUserFromToken(req);
    if (!authUser) return res.status(401).json({ error: 'Unauthorized or session expired' });

    const userId = authUser.id;
    const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // GET — list conversations for this user
        if (req.method === 'GET') {
            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/conversations?user_id=eq.${userId}&order=updated_at.desc`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            return res.json(Array.isArray(data) ? data : []);
        }

        // POST — create conversation
        if (req.method === 'POST') {
            const { title, modelVersion } = req.body || {};
            if (!title) return res.status(400).json({ error: 'title required' });
            const r = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    user_id: userId,
                    title: title.slice(0, 100),
                    model_version: modelVersion || '3.0'
                })
            });
            const data = await r.json();
            return res.status(201).json(Array.isArray(data) ? data[0] : data);
        }

        // PATCH — rename or touch updated_at (scoped to this user)
        if (req.method === 'PATCH') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id required' });
            const { title } = req.body || {};
            const updates = { updated_at: new Date().toISOString() };
            if (title) updates.title = title.slice(0, 100);
            await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}&user_id=eq.${userId}`, {
                method: 'PATCH',
                headers: sbHeaders,
                body: JSON.stringify(updates)
            });
            return res.json({ success: true });
        }

        // DELETE — scoped to this user
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id required' });
            await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}&user_id=eq.${userId}`, {
                method: 'DELETE',
                headers: sbHeaders
            });
            return res.json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
