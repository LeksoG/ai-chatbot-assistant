module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
        // GET /api/email-conversations?userId=xxx — list email conversations
        if (req.method === 'GET') {
            const { userId, id } = req.query;

            // Get single conversation with messages
            if (id) {
                const convRes = await fetch(
                    `${SUPABASE_URL}/rest/v1/email_conversations?id=eq.${id}&select=*`,
                    { headers: sbHeaders }
                );
                const convData = await convRes.json();
                if (!Array.isArray(convData) || convData.length === 0) {
                    return res.status(404).json({ error: 'Not found' });
                }

                const msgRes = await fetch(
                    `${SUPABASE_URL}/rest/v1/email_messages?email_conversation_id=eq.${id}&order=created_at.asc`,
                    { headers: sbHeaders }
                );
                const messages = await msgRes.json();

                return res.json({ ...convData[0], messages: Array.isArray(messages) ? messages : [] });
            }

            if (!userId) return res.status(400).json({ error: 'userId required' });

            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/email_conversations?user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            return res.json(Array.isArray(data) ? data : []);
        }

        // POST /api/email-conversations — create a new email conversation
        if (req.method === 'POST') {
            const { userId, title, gmailEmail } = req.body || {};
            if (!userId || !title) return res.status(400).json({ error: 'userId and title required' });

            const r = await fetch(`${SUPABASE_URL}/rest/v1/email_conversations`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    user_id: userId,
                    title: title.slice(0, 200),
                    gmail_email: gmailEmail || ''
                })
            });
            const data = await r.json();
            return res.status(201).json(Array.isArray(data) ? data[0] : data);
        }

        // PATCH /api/email-conversations?id=xxx — update email conversation
        if (req.method === 'PATCH') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id required' });

            const updates = {};
            const { title } = req.body || {};
            if (title !== undefined) updates.title = title.slice(0, 200);
            updates.updated_at = new Date().toISOString();

            await fetch(`${SUPABASE_URL}/rest/v1/email_conversations?id=eq.${id}`, {
                method: 'PATCH',
                headers: sbHeaders,
                body: JSON.stringify(updates)
            });
            return res.json({ success: true });
        }

        // DELETE /api/email-conversations?id=xxx
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'id required' });

            await fetch(`${SUPABASE_URL}/rest/v1/email_conversations?id=eq.${id}`, {
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

