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

        const { message, history = [], modelVersion = '3.0' } = req.body || {};

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const apiKey = process.env.MISTRAL_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'MISTRAL_API_KEY is not set. Go to Vercel → Project → Settings → Environment Variables and add it, then redeploy.'
            });
        }

        // Model version config
        const is35 = modelVersion === '3.5';
        const systemPrompt = is35
            ? `You are Clarity AI 3.5, an advanced and highly intelligent AI assistant. Provide thorough, nuanced, and well-reasoned responses. You may go deeper into topics when the question warrants it. Use markdown formatting effectively:
- Use **bold** for key terms and important concepts
- Use bullet or numbered lists to organize multi-part answers
- Use \`inline code\` for commands or variables
- Use fenced code blocks for multi-line code
- Use ## headers for long, structured responses
- Be analytical, precise, comprehensive, and accurate`
            : `You are Clarity AI, a helpful and intelligent AI assistant. Be concise — keep responses short and to the point (2–3 paragraphs max, fewer for simple questions). Only expand with lists or code blocks when truly necessary. Structure with markdown only when it adds real clarity:
- Use **bold** for key terms
- Use bullet lists only when listing 3+ distinct items
- Use \`inline code\` for commands or variables
- Use fenced code blocks for multi-line code
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
                temperature: is35 ? 0.65 : 0.7,
                max_tokens: is35 ? 1400 : 800
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
