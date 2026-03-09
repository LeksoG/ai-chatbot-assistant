module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
        // GET /api/email-messages?conversationId=xxx
        if (req.method === 'GET') {
            const { conversationId } = req.query;
            if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/email_messages?email_conversation_id=eq.${conversationId}&order=created_at.asc`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            return res.json(Array.isArray(data) ? data : []);
        }

        // POST /api/email-messages
        if (req.method === 'POST') {
            const { conversationId, role, content, recipient, subject, isSent } = req.body || {};
            if (!conversationId || !role || !content) {
                return res.status(400).json({ error: 'conversationId, role, and content required' });
            }

            const r = await fetch(`${SUPABASE_URL}/rest/v1/email_messages`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    email_conversation_id: conversationId,
                    role,
                    content,
                    recipient: recipient || '',
                    subject: subject || '',
                    is_sent: isSent || false
                })
            });
            const data = await r.json();

            // Update conversation updated_at
            await fetch(`${SUPABASE_URL}/rest/v1/email_conversations?id=eq.${conversationId}`, {
                method: 'PATCH',
                headers: sbHeaders,
                body: JSON.stringify({ updated_at: new Date().toISOString() })
            });

            return res.status(201).json(Array.isArray(data) ? data[0] : data);
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
