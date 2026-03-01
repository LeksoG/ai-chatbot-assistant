async function getAuthUser(req) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null;
    try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
        });
        if (!r.ok) return null;
        return await r.json();
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

    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

    const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // GET — messages for a conversation (verify ownership via join)
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

        // POST — save a message
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
