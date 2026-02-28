module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(503).json({ error: 'Supabase not configured' });
    }

    const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // GET /api/conversations?userId=xxx — list conversations for a user
        if (req.method === 'GET') {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/conversations?user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            return res.json(Array.isArray(data) ? data : []);
        }

        // POST /api/conversations — create a new conversation
        if (req.method === 'POST') {
            const { userId, title, modelVersion } = req.body || {};
            if (!userId || !title) return res.status(400).json({ error: 'userId and title required' });

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

        // PATCH /api/conversations?id=xxx — touch updated_at
        if (req.method === 'PATCH') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id required' });

            await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}`, {
                method: 'PATCH',
                headers: sbHeaders,
                body: JSON.stringify({ updated_at: new Date().toISOString() })
            });
            return res.json({ success: true });
        }

        // DELETE /api/conversations?id=xxx
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id required' });

            await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${id}`, {
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

