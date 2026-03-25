// Merged auth handler — routes by ?action= query param.
// vercel.json rewrites map the old per-file URLs to this single function:
//   /api/auth/login         → /api/auth?action=login
//   /api/auth/signup        → /api/auth?action=signup
//   /api/auth/user          → /api/auth?action=user
//   /api/auth/send-2fa-code → /api/auth?action=send-2fa-code
//   /api/auth/verify-2fa    → /api/auth?action=verify-2fa

function decodeJWTPayload(token) {
    try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch { return null; }
}

async function getAuthUser(req) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null;
    try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` }
        });
        if (r.ok) return await r.json();
    } catch { /* fall through */ }
    const payload = decodeJWTPayload(token);
    if (payload?.sub) return { id: payload.sub, email: payload.email };
    return null;
}

async function handleLogin(req, res, SUPABASE_URL, SUPABASE_KEY) {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, password, deviceTrustKey, locationKey } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) return res.status(401).json({ error: 'Invalid email or password.' });

    const userId      = loginData.user.id;
    const accessToken = loginData.access_token;

    const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const profiles = await profileRes.json();
    const profile  = Array.isArray(profiles) ? profiles[0] : null;

    if (profile && profile.two_fa_enabled) {
        if (deviceTrustKey && locationKey) {
            const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
            const trustRes = await fetch(
                `${SUPABASE_URL}/rest/v1/trusted_devices?user_id=eq.${userId}&device_key=eq.${encodeURIComponent(deviceTrustKey)}&location_key=eq.${encodeURIComponent(locationKey)}&last_used_at=gt.${twelveHoursAgo}&limit=1`,
                { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
            );
            const trustRecords = await trustRes.json();
            if (Array.isArray(trustRecords) && trustRecords.length > 0) {
                await fetch(`${SUPABASE_URL}/rest/v1/trusted_devices?id=eq.${trustRecords[0].id}`, {
                    method: 'PATCH',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                    body: JSON.stringify({ last_used_at: new Date().toISOString() })
                }).catch(() => {});
                return res.json({
                    access_token: accessToken,
                    user: { id: userId, email: loginData.user.email, first_name: profile?.first_name || '', last_name: profile?.last_name || '', two_fa_enabled: profile?.two_fa_enabled || false },
                    trusted: true
                });
            }
        }

        const code      = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await fetch(`${SUPABASE_URL}/rest/v1/two_fa_codes`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ user_id: userId, email, code, access_token: accessToken, expires_at: expiresAt })
        });

        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: process.env.EMAILJS_SERVICE_ID, template_id: process.env.EMAILJS_TEMPLATE_ID,
                user_id: process.env.EMAILJS_PUBLIC_KEY, accessToken: process.env.EMAILJS_PRIVATE_KEY,
                template_params: { to_email: email, to_name: profile.first_name || 'User', code }
            })
        }).catch(() => {});

        return res.json({ requires2FA: true });
    }

    return res.json({
        access_token: accessToken,
        user: { id: userId, email: loginData.user.email, first_name: profile?.first_name || '', last_name: profile?.last_name || '', two_fa_enabled: profile?.two_fa_enabled || false }
    });
}

async function handleSignup(req, res, SUPABASE_URL, SUPABASE_KEY) {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { firstName, lastName, email, password } = req.body || {};
    if (!firstName || !lastName || !email || !password)
        return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName } })
    });
    const signupData = await signupRes.json();
    if (!signupRes.ok) {
        const msg = signupData.message || signupData.msg || 'Signup failed';
        if (msg.toLowerCase().includes('already')) return res.status(409).json({ error: 'An account with this email already exists.' });
        return res.status(400).json({ error: msg });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ id: signupData.id, email, first_name: firstName, last_name: lastName })
    });

    return res.status(201).json({ success: true });
}

async function handleUser(req, res, SUPABASE_URL, SUPABASE_KEY) {
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const authUser = await getAuthUser(req);
    if (!authUser) return res.status(401).json({ error: 'Unauthorized' });

    const sbHeaders = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=*`, { headers: sbHeaders });
        if (!r.ok) return res.json({ id: authUser.id, email: authUser.email || '' });
        const data = await r.json();
        const profile = Array.isArray(data) ? data[0] || null : null;
        return res.json(profile || { id: authUser.id, email: authUser.email || '' });
    }

    if (req.method === 'PATCH') {
        const { firstName, lastName, two_fa_enabled, currentPassword, newPassword, email } = req.body || {};
        const profileUpdates = {};
        if (firstName !== undefined) profileUpdates.first_name = firstName;
        if (lastName  !== undefined) profileUpdates.last_name  = lastName;
        if (two_fa_enabled !== undefined) profileUpdates.two_fa_enabled = two_fa_enabled;

        if (Object.keys(profileUpdates).length) {
            const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ id: authUser.id, email: authUser.email || '', ...profileUpdates, updated_at: new Date().toISOString() })
            });
            if (!patchRes.ok) {
                const errBody = await patchRes.text().catch(() => '');
                console.error('[auth] upsert failed:', patchRes.status, errBody);
                return res.status(500).json({ error: 'Failed to update profile.' });
            }
        }

        if (newPassword && currentPassword && email) {
            const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: currentPassword })
            });
            if (!verifyRes.ok) return res.status(401).json({ error: 'Current password is incorrect.' });
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
                method: 'PUT', headers: sbHeaders, body: JSON.stringify({ password: newPassword })
            });
        }

        return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

async function handleSend2FA(req, res, SUPABASE_URL, SUPABASE_KEY) {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, access_token, first_name: clientFirstName } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const sbHeaders = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

    let userId    = null;
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
        const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`, { headers: sbHeaders });
        const profiles   = await profileRes.json();
        const profile    = Array.isArray(profiles) ? profiles[0] : null;
        if (profile?.first_name) firstName = profile.first_name;
    } else {
        const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*`, { headers: sbHeaders });
        const profiles   = await profileRes.json();
        const profile    = Array.isArray(profiles) ? profiles[0] : null;
        if (!profile) return res.status(404).json({ error: 'User not found' });
        userId = profile.id;
        if (profile?.first_name) firstName = profile.first_name;
    }

    const code      = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await fetch(`${SUPABASE_URL}/rest/v1/two_fa_codes`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ user_id: userId, email, code, access_token: access_token || '', expires_at: expiresAt })
    });

    const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            service_id: process.env.EMAILJS_SERVICE_ID, template_id: process.env.EMAILJS_TEMPLATE_ID,
            user_id: process.env.EMAILJS_PUBLIC_KEY, accessToken: process.env.EMAILJS_PRIVATE_KEY,
            template_params: { to_email: email, to_name: firstName, code }
        })
    }).catch(err => { console.error('[auth] EmailJS fetch error:', err); return null; });

    if (!emailRes || !emailRes.ok) {
        const errText = emailRes ? await emailRes.text().catch(() => '') : 'network error';
        console.error('[auth] EmailJS send failed:', emailRes?.status, errText);
        return res.json({ sent: true, emailOk: false, emailStatus: emailRes?.status ?? 0, emailError: errText });
    }

    return res.json({ sent: true, emailOk: true });
}

async function handleVerify2FA(req, res, SUPABASE_URL, SUPABASE_KEY) {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, code, locationKey, ipAddress } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });

    const sbHeaders = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

    const userRes  = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*`, { headers: sbHeaders });
    const profiles = await userRes.json();
    const profile  = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile) return res.status(404).json({ error: 'User not found' });

    const now     = new Date().toISOString();
    const codeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/two_fa_codes?user_id=eq.${profile.id}&code=eq.${encodeURIComponent(code)}&expires_at=gt.${now}&order=created_at.desc&limit=1`,
        { headers: sbHeaders }
    );
    const codes = await codeRes.json();
    if (!Array.isArray(codes) || !codes.length) return res.status(401).json({ error: 'Invalid or expired code.' });

    const record      = codes[0];
    const accessToken = record.access_token;

    await fetch(`${SUPABASE_URL}/rest/v1/two_fa_codes?user_id=eq.${profile.id}`, {
        method: 'DELETE', headers: sbHeaders
    });

    let deviceTrustKey = null;
    if (locationKey) {
        const crypto = require('crypto');
        deviceTrustKey = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
        await fetch(`${SUPABASE_URL}/rest/v1/trusted_devices`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ user_id: profile.id, device_key: deviceTrustKey, location_key: locationKey, ip_address: ipAddress || '', last_used_at: new Date().toISOString() })
        }).catch(() => {});
    }

    return res.json({
        access_token: accessToken,
        device_trust_key: deviceTrustKey,
        user: { id: profile.id, email: profile.email, first_name: profile.first_name || '', last_name: profile.last_name || '', two_fa_enabled: profile.two_fa_enabled || false }
    });
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase not configured' });

    const action = req.query.action;

    try {
        if (action === 'login')         return await handleLogin(req, res, SUPABASE_URL, SUPABASE_KEY);
        if (action === 'signup')        return await handleSignup(req, res, SUPABASE_URL, SUPABASE_KEY);
        if (action === 'user')          return await handleUser(req, res, SUPABASE_URL, SUPABASE_KEY);
        if (action === 'send-2fa-code') return await handleSend2FA(req, res, SUPABASE_URL, SUPABASE_KEY);
        if (action === 'verify-2fa')    return await handleVerify2FA(req, res, SUPABASE_URL, SUPABASE_KEY);
        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
