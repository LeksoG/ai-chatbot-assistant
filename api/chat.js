module.exports = async function handler(req, res) {
    // Always return JSON, even on unexpected crashes
    try {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const { message, history = [] } = req.body || {};

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const apiKey = process.env.MISTRAL_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'MISTRAL_API_KEY is not set. Go to Vercel → Project → Settings → Environment Variables and add it, then redeploy.'
            });
        }

        const systemPrompt = `You are Clarity AI, a helpful, knowledgeable, and intelligent AI assistant. Structure your responses clearly using markdown:
- Use **bold** for key terms and important points
- Use bullet lists (- item) or numbered lists (1. item) to organize information
- Use \`inline code\` for commands, variables, or short code snippets
- Use fenced code blocks with language names for multi-line code (e.g. \`\`\`python)
- Use ## for main section headers and ### for subsections when the response is long
- Use > blockquotes for important callouts or quotes
- Keep responses concise, clear, and well-structured
- Be friendly, professional, and accurate`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: message }
        ];

        const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'mistral-large-latest',
                messages,
                temperature: 0.7,
                max_tokens: 2048
            })
        });

        if (!mistralRes.ok) {
            const errorData = await mistralRes.json().catch(() => ({}));
            return res.status(mistralRes.status).json({
                error: errorData.message || `Mistral API error (${mistralRes.status})`
            });
        }

        const data = await mistralRes.json();
        const reply = data.choices[0].message.content;

        return res.status(200).json({ reply });

    } catch (err) {
        console.error('[chat] unexpected error:', err);
        return res.status(500).json({
            error: `Server error: ${err.message || 'Unknown error'}. Check Vercel function logs.`
        });
    }
};
