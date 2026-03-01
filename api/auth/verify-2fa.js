module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });

    try {
        // Find user profile by email
        const userRes = await fetch(
            `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const profiles = await userRes.json();
        const profile  = Array.isArray(profiles) ? profiles[0] : null;
        if (!profile) return res.status(404).json({ error: 'User not found' });

        // Look up matching, non-expired code
        const now      = new Date().toISOString();
        const codeRes  = await fetch(
            `${SUPABASE_URL}/rest/v1/two_fa_codes?user_id=eq.${profile.id}&code=eq.${encodeURIComponent(code)}&expires_at=gt.${now}&order=created_at.desc&limit=1`,
            { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
        );
        const codes = await codeRes.json();
        if (!Array.isArray(codes) || !codes.length) {
            return res.status(401).json({ error: 'Invalid or expired code.' });
        }

        const record      = codes[0];
        const accessToken = record.access_token;

        // Delete all codes for this user (clean up)
        await fetch(`${SUPABASE_URL}/rest/v1/two_fa_codes?user_id=eq.${profile.id}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });

        return res.json({
            access_token: accessToken,
            user: {
                id:             profile.id,
                email:          profile.email,
                first_name:     profile.first_name  || '',
                last_name:      profile.last_name   || '',
                two_fa_enabled: profile.two_fa_enabled || false
            }
        });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
