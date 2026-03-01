module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const { firstName, lastName, email, password } = req.body || {};
    if (!firstName || !lastName || !email || !password)
        return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    try {
        // Create auth user via Supabase admin API
        const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                password,
                email_confirm: true,
                user_metadata: { first_name: firstName, last_name: lastName }
            })
        });

        const signupData = await signupRes.json();

        if (!signupRes.ok) {
            const msg = signupData.message || signupData.msg || 'Signup failed';
            if (msg.toLowerCase().includes('already')) {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }
            return res.status(400).json({ error: msg });
        }

        // Insert profile into custom users table
        await fetch(`${SUPABASE_URL}/rest/v1/users`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                id: signupData.id,
                email,
                first_name: firstName,
                last_name: lastName
            })
        });

        return res.status(201).json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
