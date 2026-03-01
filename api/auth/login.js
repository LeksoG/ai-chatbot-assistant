module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    try {
        // Authenticate with Supabase
        const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const loginData = await loginRes.json();

        if (!loginRes.ok) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const userId      = loginData.user.id;
        const accessToken = loginData.access_token;

        // Fetch user profile
        const profileRes = await fetch(
            `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const profiles = await profileRes.json();
        const profile  = Array.isArray(profiles) ? profiles[0] : null;

        // Handle 2FA
        if (profile && profile.two_fa_enabled) {
            const code      = String(Math.floor(100000 + Math.random() * 900000));
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

            // Store code + access_token temporarily so verify-2fa can return it
            await fetch(`${SUPABASE_URL}/rest/v1/two_fa_codes`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    user_id: userId,
                    email,
                    code,
                    access_token: accessToken,
                    expires_at: expiresAt
                })
            });

            // Send code via EmailJS
            await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_id:  process.env.EMAILJS_SERVICE_ID,
                    template_id: process.env.EMAILJS_TEMPLATE_ID,
                    user_id:     process.env.EMAILJS_PUBLIC_KEY,
                    accessToken: process.env.EMAILJS_PRIVATE_KEY,
                    template_params: {
                        to_email: email,
                        to_name:  profile.first_name || 'User',
                        code
                    }
                })
            }).catch(() => {}); // don't fail if email fails

            return res.json({ requires2FA: true });
        }

        // Fall back to auth user_metadata if users table row is missing
        const meta = loginData.user.user_metadata || {};

        // No 2FA — return token and profile
        return res.json({
            access_token: accessToken,
            user: {
                id:             userId,
                email:          loginData.user.email,
                first_name:     profile?.first_name  || meta.first_name  || '',
                last_name:      profile?.last_name   || meta.last_name   || '',
                two_fa_enabled: profile?.two_fa_enabled || false
            }
        });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
