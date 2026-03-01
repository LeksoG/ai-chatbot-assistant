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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
            const { conversationId } = req.query;
            if (!conversationId) return res.status(400).json({ error: 'conversationId required' });
            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/messages?conversation_id=eq.${conversationId}&order=created_at.asc`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            return res.json(Array.isArray(data) ? data : []);
        }

        if (req.method === 'POST') {
            const { conversationId, role, content } = req.body || {};
            if (!conversationId || !role || !content)
                return res.status(400).json({ error: 'conversationId, role, and content required' });
            const r = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                body: JSON.stringify({ conversation_id: conversationId, role, content })
            });
            const data = await r.json();
            return res.status(201).json(Array.isArray(data) ? data[0] : data);
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
