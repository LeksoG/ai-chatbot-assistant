module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
        // GET /api/artifacts — list all artifacts (public)
        // GET /api/artifacts?id=xxx — get single artifact with code
        // GET /api/artifacts?search=xxx — search artifacts by title/description
        if (req.method === 'GET') {
            const { id, search } = req.query;

            if (id) {
                const r = await fetch(
                    `${SUPABASE_URL}/rest/v1/artifacts?id=eq.${encodeURIComponent(id)}&select=id,user_id,user_name,title,description,code,created_at`,
                    { headers: sbHeaders }
                );
                const data = await r.json();
                if (!Array.isArray(data) || data.length === 0) {
                    return res.status(404).json({ error: 'Artifact not found' });
                }
                return res.json(data[0]);
            }

            let url = `${SUPABASE_URL}/rest/v1/artifacts?select=id,user_id,user_name,title,description,created_at&order=created_at.desc`;

            if (search) {
                const q = encodeURIComponent(`%${search}%`);
                url += `&or=(title.ilike.${q},description.ilike.${q})`;
            }

            const r = await fetch(url, { headers: sbHeaders });
            const data = await r.json();
            return res.json(Array.isArray(data) ? data : []);
        }

        // POST /api/artifacts — publish a new artifact
        if (req.method === 'POST') {
            const { userId, userName, title, description, code } = req.body || {};
            if (!userId || !title || !code) {
                return res.status(400).json({ error: 'userId, title, and code required' });
            }

            const r = await fetch(`${SUPABASE_URL}/rest/v1/artifacts`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    user_id: userId,
                    user_name: (userName || 'Anonymous').slice(0, 100),
                    title: title.slice(0, 200),
                    description: (description || '').slice(0, 500),
                    code: code
                })
            });
            const data = await r.json();
            if (!r.ok) {
                return res.status(r.status).json({ error: Array.isArray(data) ? data[0]?.message : data?.message || 'Failed to create' });
            }
            return res.status(201).json(Array.isArray(data) ? data[0] : data);
        }

        // DELETE /api/artifacts?id=xxx — delete an artifact (only own)
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id required' });

            const authHeader = req.headers['authorization'] || '';
            const token = authHeader.replace('Bearer ', '');
            let userId = null;
            if (token) {
                try {
                    const parts = token.split('.');
                    if (parts.length === 3) {
                        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                        userId = payload.sub || null;
                    }
                } catch (_) {}
            }

            const checkR = await fetch(
                `${SUPABASE_URL}/rest/v1/artifacts?id=eq.${encodeURIComponent(id)}&select=user_id`,
                { headers: sbHeaders }
            );
            const checkData = await checkR.json();
            if (!Array.isArray(checkData) || checkData.length === 0) {
                return res.status(404).json({ error: 'Artifact not found' });
            }
            if (userId && checkData[0].user_id !== userId) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            await fetch(`${SUPABASE_URL}/rest/v1/artifacts?id=eq.${encodeURIComponent(id)}`, {
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
