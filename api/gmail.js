module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(503).json({ error: 'Supabase not configured' });
    }

    const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        const action = req.query.action || req.body?.action;

        // ════════════════════════════════════════════════════════════
        //  EMAIL CONVERSATIONS  (action=conversations)
        // ════════════════════════════════════════════════════════════

        if (action === 'conversations') {
            // GET — list or get single conversation with messages
            if (req.method === 'GET') {
                const { userId, id } = req.query;

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

            // POST — create
            if (req.method === 'POST') {
                const { userId, title, gmailEmail } = req.body || {};
                if (!userId || !title) return res.status(400).json({ error: 'userId and title required' });
                const r = await fetch(`${SUPABASE_URL}/rest/v1/email_conversations`, {
                    method: 'POST',
                    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                    body: JSON.stringify({ user_id: userId, title: title.slice(0, 200), gmail_email: gmailEmail || '' })
                });
                const data = await r.json();
                return res.status(201).json(Array.isArray(data) ? data[0] : data);
            }

            // PATCH — update
            if (req.method === 'PATCH') {
                const { id } = req.query;
                if (!id) return res.status(400).json({ error: 'id required' });
                const updates = { updated_at: new Date().toISOString() };
                const { title } = req.body || {};
                if (title !== undefined) updates.title = title.slice(0, 200);
                await fetch(`${SUPABASE_URL}/rest/v1/email_conversations?id=eq.${id}`, {
                    method: 'PATCH', headers: sbHeaders, body: JSON.stringify(updates)
                });
                return res.json({ success: true });
            }

            // DELETE
            if (req.method === 'DELETE') {
                const { id } = req.query;
                if (!id) return res.status(400).json({ error: 'id required' });
                await fetch(`${SUPABASE_URL}/rest/v1/email_conversations?id=eq.${id}`, {
                    method: 'DELETE', headers: sbHeaders
                });
                return res.json({ success: true });
            }

            return res.status(405).json({ error: 'Method not allowed' });
        }

        // ════════════════════════════════════════════════════════════
        //  EMAIL MESSAGES  (action=messages)
        // ════════════════════════════════════════════════════════════

        if (action === 'messages') {
            // GET
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

            // POST
            if (req.method === 'POST') {
                const { conversationId, role, content, recipient, subject, isSent } = req.body || {};
                if (!conversationId || !role || !content) {
                    return res.status(400).json({ error: 'conversationId, role, and content required' });
                }
                const r = await fetch(`${SUPABASE_URL}/rest/v1/email_messages`, {
                    method: 'POST',
                    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                    body: JSON.stringify({
                        email_conversation_id: conversationId, role, content,
                        recipient: recipient || '', subject: subject || '', is_sent: isSent || false
                    })
                });
                const data = await r.json();
                await fetch(`${SUPABASE_URL}/rest/v1/email_conversations?id=eq.${conversationId}`, {
                    method: 'PATCH', headers: sbHeaders,
                    body: JSON.stringify({ updated_at: new Date().toISOString() })
                });
                return res.status(201).json(Array.isArray(data) ? data[0] : data);
            }

            return res.status(405).json({ error: 'Method not allowed' });
        }

        // ════════════════════════════════════════════════════════════
        //  GMAIL OAUTH & API ACTIONS
        // ════════════════════════════════════════════════════════════

        // Build redirect URI — use env var for exact match with Google Console
        const APP_URL = process.env.APP_URL || (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
        const REDIRECT_URI = APP_URL + '/api/gmail?action=callback';

        // auth-url — generate Google OAuth URL
        if (action === 'auth-url') {
            if (!GOOGLE_CLIENT_ID) {
                return res.status(503).json({ error: 'Google OAuth not configured' });
            }
            const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email');
            const state = req.query.userId || '';
            const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
            return res.json({ url });
        }

        // callback — OAuth callback from Google
        if (action === 'callback' && req.method === 'GET') {
            try {
                const { code, state: userId } = req.query;
                console.log('[Gmail callback] code:', code ? 'present' : 'MISSING', 'userId:', userId);
                if (!code) return res.status(400).send('Missing authorization code');
                if (!userId) return res.status(400).send('Missing userId in state parameter');

                const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
                        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'
                    })
                });
                const tokens = await tokenRes.json();
                console.log('[Gmail callback] token exchange status:', tokenRes.status, 'has access_token:', !!tokens.access_token, 'has refresh_token:', !!tokens.refresh_token);
                if (!tokens.access_token) {
                    console.error('[Gmail callback] Token error:', JSON.stringify(tokens));
                    return res.writeHead(302, { 'Location': `/app?gmail=error&reason=${encodeURIComponent(tokens.error_description || tokens.error || 'no_access_token')}` }).end();
                }

                const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { 'Authorization': `Bearer ${tokens.access_token}` }
                });
                const profile = await profileRes.json();
                const gmailEmail = profile.email || '';
                console.log('[Gmail callback] profile email:', gmailEmail);

                const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
                const existCheck = await fetch(
                    `${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}&select=id`,
                    { headers: sbHeaders }
                );
                const existing = await existCheck.json();
                console.log('[Gmail callback] existing check:', existCheck.status, JSON.stringify(existing));

                let dbRes;
                if (Array.isArray(existing) && existing.length > 0) {
                    dbRes = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}`, {
                        method: 'PATCH', headers: sbHeaders,
                        body: JSON.stringify({
                            email: gmailEmail, access_token: tokens.access_token,
                            refresh_token: tokens.refresh_token || '', token_expiry: expiry,
                            updated_at: new Date().toISOString()
                        })
                    });
                } else {
                    dbRes = await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections`, {
                        method: 'POST',
                        headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                        body: JSON.stringify({
                            user_id: userId, email: gmailEmail,
                            access_token: tokens.access_token,
                            refresh_token: tokens.refresh_token || '', token_expiry: expiry
                        })
                    });
                }
                const dbBody = await dbRes.text();
                console.log('[Gmail callback] DB write:', dbRes.status, dbBody);

                if (dbRes.status >= 400) {
                    return res.writeHead(302, { 'Location': `/app?gmail=error&reason=${encodeURIComponent('db_write_failed_' + dbRes.status + '_' + dbBody)}` }).end();
                }

                return res.writeHead(302, { 'Location': '/app?gmail=connected' }).end();
            } catch (err) {
                console.error('[Gmail callback] Unhandled error:', err);
                return res.writeHead(302, { 'Location': `/app?gmail=error&reason=${encodeURIComponent(err.message)}` }).end();
            }
        }

        // status — check connection
        if (action === 'status') {
            const { userId } = req.query;
            console.log('[Gmail status] userId:', userId);
            if (!userId) return res.status(400).json({ error: 'userId required' });
            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}&select=email,token_expiry`,
                { headers: sbHeaders }
            );
            const data = await r.json();
            console.log('[Gmail status] DB result:', JSON.stringify(data));
            if (Array.isArray(data) && data.length > 0) {
                return res.json({ connected: true, email: data[0].email });
            }
            return res.json({ connected: false });
        }

        // disconnect
        if (action === 'disconnect') {
            const { userId } = req.body || {};
            if (!userId) return res.status(400).json({ error: 'userId required' });
            await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}`, {
                method: 'DELETE', headers: sbHeaders
            });
            return res.json({ success: true });
        }

        // Helper: get valid access token for a user (with refresh)
        async function getAccessToken(userId) {
            const connRes = await fetch(
                `${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}&select=*`,
                { headers: sbHeaders }
            );
            const connData = await connRes.json();
            if (!Array.isArray(connData) || connData.length === 0) return null;

            let accessToken = connData[0].access_token;
            const refreshToken = connData[0].refresh_token;
            const tokenExpiry = new Date(connData[0].token_expiry);

            if (tokenExpiry < new Date() && refreshToken && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
                const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
                        refresh_token: refreshToken, grant_type: 'refresh_token'
                    })
                });
                const newTokens = await refreshRes.json();
                if (newTokens.access_token) {
                    accessToken = newTokens.access_token;
                    const newExpiry = new Date(Date.now() + (newTokens.expires_in || 3600) * 1000).toISOString();
                    await fetch(`${SUPABASE_URL}/rest/v1/gmail_connections?user_id=eq.${encodeURIComponent(userId)}`, {
                        method: 'PATCH', headers: sbHeaders,
                        body: JSON.stringify({ access_token: accessToken, token_expiry: newExpiry, updated_at: new Date().toISOString() })
                    });
                }
            }

            return { accessToken, email: connData[0].email };
        }

        // emails — fetch recent inbox
        if (action === 'emails') {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'userId required' });

            const creds = await getAccessToken(userId);
            if (!creds) return res.status(401).json({ error: 'Gmail not connected' });

            const gmailRes = await fetch(
                'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=in:inbox',
                { headers: { 'Authorization': `Bearer ${creds.accessToken}` } }
            );
            const gmailData = await gmailRes.json();

            if (!gmailData.messages || gmailData.messages.length === 0) {
                return res.json({ emails: [] });
            }

            const emails = [];
            for (const msg of gmailData.messages.slice(0, 10)) {
                const detailRes = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
                    { headers: { 'Authorization': `Bearer ${creds.accessToken}` } }
                );
                const detail = await detailRes.json();
                const headers = detail.payload?.headers || [];
                emails.push({
                    id: msg.id,
                    from: headers.find(h => h.name === 'From')?.value || '',
                    subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
                    date: headers.find(h => h.name === 'Date')?.value || '',
                    snippet: detail.snippet || ''
                });
            }
            return res.json({ emails });
        }

        // send — send email via Gmail API
        if (action === 'send') {
            const { userId, to, subject, body: emailBody } = req.body || {};
            if (!userId || !to || !emailBody) {
                return res.status(400).json({ error: 'userId, to, and body are required' });
            }

            const creds = await getAccessToken(userId);
            if (!creds) return res.status(401).json({ error: 'Gmail not connected' });

            const emailLines = [
                `From: ${creds.email}`, `To: ${to}`,
                `Subject: ${subject || '(no subject)'}`,
                'Content-Type: text/html; charset=utf-8', '', emailBody
            ];
            const rawEmail = Buffer.from(emailLines.join('\r\n')).toString('base64url');

            const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw: rawEmail })
            });
            const sendData = await sendRes.json();
            if (!sendRes.ok) {
                return res.status(sendRes.status).json({ error: sendData.error?.message || 'Failed to send email' });
            }
            return res.json({ success: true, messageId: sendData.id });
        }

        // suggestions — AI suggestions from inbox
        if (action === 'suggestions') {
            const { userId, emails } = req.body || {};
            if (!userId || !emails) return res.status(400).json({ error: 'userId and emails required' });

            const apiKey = process.env.MISTRAL_API_KEY;
            if (!apiKey) return res.status(500).json({ error: 'MISTRAL_API_KEY not set' });

            const emailSummary = emails.slice(0, 8).map((e, i) =>
                `${i + 1}. From: ${e.from} | Subject: ${e.subject} | Preview: ${e.snippet}`
            ).join('\n');

            const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: 'mistral-small-latest',
                    messages: [
                        { role: 'system', content: 'You are an email assistant. Based on the user\'s recent emails, suggest 4 quick actions they might want to take. Return ONLY a JSON array of 4 objects with "icon" (one of: reply, forward, star, alert-circle, clock, check-circle, file-text, users), "title" (3-5 words), and "prompt" (the full prompt to use). No markdown, no explanation.' },
                        { role: 'user', content: `Here are my recent emails:\n${emailSummary}\n\nSuggest 4 relevant quick actions.` }
                    ],
                    temperature: 0.7, max_tokens: 600
                })
            });
            const data = await mistralRes.json();
            let suggestions = [];
            try {
                const raw = data.choices[0].message.content.trim();
                suggestions = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, ''));
            } catch {
                suggestions = [
                    { icon: 'reply', title: 'Reply to latest email', prompt: 'Draft a reply to my most recent email' },
                    { icon: 'file-text', title: 'Summarize my inbox', prompt: 'Summarize my recent emails and highlight important ones' },
                    { icon: 'clock', title: 'Follow up on pending', prompt: 'Draft a follow-up email for emails I haven\'t replied to' },
                    { icon: 'check-circle', title: 'Draft a thank you', prompt: 'Write a thank you email for the most recent conversation' }
                ];
            }
            return res.json({ suggestions });
        }

        // compose — AI email drafting
        if (action === 'compose') {
            const { prompt, history = [], emails = [] } = req.body || {};
            if (!prompt) return res.status(400).json({ error: 'prompt required' });

            const apiKey = process.env.MISTRAL_API_KEY;
            if (!apiKey) return res.status(500).json({ error: 'MISTRAL_API_KEY not set' });

            const emailContext = emails.length > 0
                ? `\n\nUser's recent emails for context:\n${emails.slice(0, 5).map(e => `- From: ${e.from} | Subject: ${e.subject} | Preview: ${e.snippet}`).join('\n')}`
                : '';

            const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: 'mistral-large-latest',
                    messages: [
                        { role: 'system', content: `You are an AI email assistant for Clarity AI. When the user asks you to draft, reply, or compose an email, produce a well-structured email response. Format your response as follows:\n\n**Subject:** [suggested subject line]\n\n---\n\n[Full email body with proper greeting, content, and sign-off]\n\n---\n\nKeep the email professional, clear, and concise. If the user wants to reply to a specific email, reference the context provided.${emailContext}` },
                        ...history,
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7, max_tokens: 3000
                })
            });
            const data = await mistralRes.json();
            if (!mistralRes.ok) {
                return res.status(mistralRes.status).json({ error: data.message || 'AI error' });
            }
            return res.json({ reply: data.choices[0].message.content });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('[gmail] error:', err);
        return res.status(500).json({ error: err.message });
    }
};
