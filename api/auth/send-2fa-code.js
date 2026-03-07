module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const { email, access_token, first_name: clientFirstName } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // Use the session token to get the auth user ID, then look up profile
        // by ID (same as login.js) — more reliable than querying by email column.
        let userId = null;
        let firstName = clientFirstName || 'User';

        if (access_token) {
            const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${access_token}` }
            });
            if (authRes.ok) {
                const authUser = await authRes.json();
                userId = authUser.id;
                if (authUser.user_metadata?.first_name) firstName = authUser.user_metadata.first_name;
            }
        }

        if (userId) {
            const profileRes = await fetch(
                `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`,
                { headers: sbHeaders }
            );
            const profiles = await profileRes.json();
            const profile  = Array.isArray(profiles) ? profiles[0] : null;
            if (profile?.first_name) firstName = profile.first_name;
        } else {
            // Fallback when no token: look up by email column
            const profileRes = await fetch(
                `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*`,
                { headers: sbHeaders }
            );
            const profiles = await profileRes.json();
            const profile  = Array.isArray(profiles) ? profiles[0] : null;
            if (!profile) return res.status(404).json({ error: 'User not found' });
            userId = profile.id;
            if (profile?.first_name) firstName = profile.first_name;
        }

        const code      = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await fetch(`${SUPABASE_URL}/rest/v1/two_fa_codes`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
                user_id:      userId,
                email,
                code,
                access_token: access_token || '',
                expires_at:   expiresAt
            })
        });

        // Send code via EmailJS — log failures instead of silently swallowing them
        const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id:  process.env.EMAILJS_SERVICE_ID,
                template_id: process.env.EMAILJS_TEMPLATE_ID,
                user_id:     process.env.EMAILJS_PUBLIC_KEY,
                accessToken: process.env.EMAILJS_PRIVATE_KEY,
                template_params: {
                    to_email: email,
                    to_name:  firstName,
                    code
                }
            })
        }).catch(err => { console.error('[send-2fa-code] EmailJS fetch error:', err); return null; });

        if (!emailRes || !emailRes.ok) {
            const errText = emailRes ? await emailRes.text().catch(() => '') : 'network error';
            console.error('[send-2fa-code] EmailJS send failed:', emailRes?.status, errText);
            // Return success so the gate stays open, but include emailOk:false so
            // the client can show a diagnostic message to help debug config issues.
            return res.json({ sent: true, emailOk: false, emailStatus: emailRes?.status ?? 0, emailError: errText });
        }

        return res.json({ sent: true, emailOk: true });
    } catch (err) {
        console.error('[send-2fa-code] error:', err);
        return res.status(500).json({ error: err.message });
    }
};
