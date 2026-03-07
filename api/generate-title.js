module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'MISTRAL_API_KEY not set' });

    try {
        const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'mistral-small-latest',
                messages: [
                    {
                        role: 'system',
                        content: 'Generate a 2-word title for a conversation based on the user\'s message. Return ONLY exactly 2 words, no punctuation, no explanation, no quotes. Capitalize each word. Examples: "Weather App", "Code Review", "Email Draft", "Trip Planner", "Bug Fix".'
                    },
                    { role: 'user', content: message.slice(0, 300) }
                ],
                temperature: 0.5,
                max_tokens: 10
            })
        });

        if (!resp.ok) return res.status(500).json({ error: 'AI error' });

        const data = await resp.json();
        let title = (data.choices?.[0]?.message?.content || '').trim();
        // Strip any punctuation and keep only first 2 words
        title = title.replace(/[^\w\s]/g, '').trim().split(/\s+/).slice(0, 2).join(' ');
        // Capitalize each word
        title = title.split(' ').map(w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '').join(' ').trim();

        return res.status(200).json({ title: title || 'New Chat' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

