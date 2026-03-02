module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
        // GET /api/canvas-pages?conversationId=xxx — fetch all canvas pages for a conversation
        if (req.method === 'GET') {
            const { conversationId } = req.query;
            if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/canvas_pages?conversation_id=eq.${encodeURIComponent(conversationId)}&order=page_index.asc`,
                { headers: sbHeaders }
            );
            if (!r.ok) {
                return res.json([]);
            }
            const data = await r.json();
            return res.json(Array.isArray(data) ? data : []);
        }

        // POST /api/canvas-pages — save a canvas page (upsert by conversation_id + page_index)
        if (req.method === 'POST') {
            const { conversationId, pageIndex, code, prompt } = req.body || {};
            if (!conversationId || pageIndex === undefined || !code) {
                return res.status(400).json({ error: 'conversationId, pageIndex, and code required' });
            }

            // Upsert: use Supabase's on-conflict resolution
            // First try to find existing page
            const findRes = await fetch(
                `${SUPABASE_URL}/rest/v1/canvas_pages?conversation_id=eq.${encodeURIComponent(conversationId)}&page_index=eq.${pageIndex}`,
                { headers: sbHeaders }
            );
            const existing = await findRes.json();

            if (Array.isArray(existing) && existing.length > 0) {
                // Update existing page
                await fetch(
                    `${SUPABASE_URL}/rest/v1/canvas_pages?id=eq.${existing[0].id}`,
                    {
                        method: 'PATCH',
                        headers: sbHeaders,
                        body: JSON.stringify({ code, prompt: prompt || '' })
                    }
                );
            } else {
                // Insert new page
                await fetch(`${SUPABASE_URL}/rest/v1/canvas_pages`, {
                    method: 'POST',
                    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                    body: JSON.stringify({
                        conversation_id: conversationId,
                        page_index: pageIndex,
                        code,
                        prompt: prompt || ''
                    })
                });
            }

            return res.status(201).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

