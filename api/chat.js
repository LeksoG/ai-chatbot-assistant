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

        const { message, history = [], modelVersion = '3.6', images = [] } = req.body || {};

        const hasImages = Array.isArray(images) && images.length > 0;

        if (!message && !hasImages) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const apiKey = process.env.MISTRAL_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'MISTRAL_API_KEY is not set. Go to Vercel → Project → Settings → Environment Variables and add it, then redeploy.'
            });
        }

        // Model routing: use vision-capable Pixtral when images are present
        let model, maxTokens;
        if (hasImages) {
            // pixtral-12b supports vision and is available on standard API keys
            model     = 'pixtral-12b-2409';
            maxTokens = 8000;
        } else {
            model     = modelVersion === '3.6' ? 'mistral-large-latest' : 'mistral-small-latest';
            maxTokens = modelVersion === '3.6' ? 8000 : 5000;
        }

        const systemPrompt = `You are Clarity AI, a helpful AI assistant. Rules:
- Be extremely concise. No filler, no preamble, no repeating the question.
- Simple questions: 1–2 sentences max.
- Code tasks: Say what you'll do in ONE short sentence, then give the code. No explanation after the code.
- When the user provides [Current canvas code] and asks for changes: describe what you changed in one sentence max, then return the FULL updated code. Do not explain unchanged parts.
- Use **bold** for key terms, \`inline code\` for commands/variables, code blocks for code.
- Use bullet lists only for 3+ items. Never over-explain.
- When images are provided, analyze them thoroughly and accurately.

HTML/website generation rules (CRITICAL — always follow these):
- ALWAYS produce a single, fully self-contained HTML file. Never reference external files.
- All CSS must be in an inline <style> tag. Never use <link rel="stylesheet"> or src="styles.css" etc.
- All JavaScript must be in inline <script> tags. Never use src="script.js" etc.
- NEVER reference local image files (e.g. hero.jpg, chef-portrait.jpg, logo.png). Instead use one of:
  a) CSS gradients or solid color backgrounds
  b) Inline SVG illustrations
  c) A real placeholder service with a full URL: https://picsum.photos/800/400 (append ?random=N for variety)
- If an icon or logo is needed, draw it with inline SVG or use a Unicode character.
- The output must render correctly in a sandboxed iframe with no internet access to local paths.`;

        // Build user message content — multimodal when images present
        let userContent;
        if (hasImages) {
            userContent = [
                { type: 'text', text: message || 'Please analyze the attached image(s).' },
                ...images.map(url => ({ type: 'image_url', image_url: { url } }))
            ];
        } else {
            userContent = message;
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: userContent }
        ];

        const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.7,
                max_tokens: maxTokens
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

