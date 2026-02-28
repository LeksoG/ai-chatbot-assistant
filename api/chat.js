module.exports = async function handler(req, res) {
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

    const { message, history = [] } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    const apiKey = process.env.MISTRAL_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: 'Mistral API key not configured. Add MISTRAL_API_KEY to your Vercel environment variables.'
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

    try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
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

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return res.status(response.status).json({
                error: errorData.message || `Mistral API error (${response.status})`
            });
        }

        const data = await response.json();
        const reply = data.choices[0].message.content;

        return res.status(200).json({ reply });

    } catch (error) {
        console.error('Mistral API error:', error);
        return res.status(500).json({ error: 'Failed to connect to Mistral API. Please try again.' });
    }
};
