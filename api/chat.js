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

        const { message, history = [], modelVersion = '3.6', images = [], mode = 'chat' } = req.body || {};

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
            model     = 'pixtral-12b-2409';
            maxTokens = 6000;
        } else {
            model     = modelVersion === '3.6' ? 'mistral-large-latest' : 'mistral-small-latest';
            // Lower ceiling speeds up generation — model stops as soon as the
            // response is complete anyway; 10k was rarely needed and added latency.
            maxTokens = modelVersion === '3.6' ? 6000 : 4000;
        }

        // Trim history aggressively to keep context small and avoid timeouts.
        // Keep last 6 messages; truncate any long message to 2500 chars.
        const MAX_HISTORY = 6;
        const MAX_MSG_CHARS = 2500;
        const trimmedHistory = history
            .slice(-MAX_HISTORY)
            .map(m => {
                if (typeof m.content === 'string' && m.content.length > MAX_MSG_CHARS) {
                    return { ...m, content: m.content.slice(0, MAX_MSG_CHARS) + '\n[... truncated ...]' };
                }
                return m;
            });

        const codingSystemPrompt = `You are Clarity Coding, an expert AI coding assistant integrated with GitHub. Rules:
- Help the user write, fix, explain, and refactor code.
- When given a GitHub repo context like [GitHub repo: owner/repo], tailor advice to that project.
- Always return code in fenced code blocks with the correct language tag (e.g. \`\`\`javascript).
- CRITICAL: The very first line inside every code block MUST be a comment with the file path, e.g. \`// src/app.js\` or \`# utils/helper.py\`. This is required so the system knows which file to update.
- When the user provides [Current content of \`path/file\`]: you are editing an EXISTING file. Make ONLY the minimal targeted change requested. Preserve every other line exactly as-is — same whitespace, same comments, same logic. Return the COMPLETE file so it can be committed, but change as little as possible.
- For new files: infer a sensible file path from the repo structure and project context.
- Be concise. One sentence of explanation, then the code. No filler.
- If asked to commit or push changes, remind the user to use the "Commit to GitHub" button that appears below your code blocks.
- Support all languages: JavaScript, TypeScript, Python, Rust, Go, Java, C++, HTML, CSS, SQL, etc.`;

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
            { role: 'system', content: mode === 'coding' ? codingSystemPrompt : systemPrompt },
            ...trimmedHistory,
            { role: 'user', content: userContent }
        ];

        const requestBody = JSON.stringify({
            model,
            messages,
            temperature: mode === 'coding' ? 0.2 : 0.7,
            max_tokens: maxTokens
        });

        // Abort the Mistral request after 58 s — just under the 60 s Vercel
        // maxDuration set for this function — so we return a clean error
        // instead of a silent gateway cut-off.
        const TIMEOUT_MS = 58000;

        // Retry up to 2 times on 429; don't retry on other errors
        let mistralRes;
        const MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            try {
                mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: requestBody,
                    signal: controller.signal
                });
            } catch (fetchErr) {
                clearTimeout(timer);
                if (fetchErr.name === 'AbortError') {
                    return res.status(504).json({ error: 'The request timed out — the prompt may be too large. Try a shorter message or start a new session.' });
                }
                throw fetchErr;
            }
            clearTimeout(timer);

            if (mistralRes.status !== 429 || attempt === MAX_RETRIES) break;

            const retryAfter = parseInt(mistralRes.headers.get('Retry-After') || '0', 10);
            const backoffMs  = retryAfter > 0 ? retryAfter * 1000 : (2 ** attempt) * 1500;
            await new Promise(r => setTimeout(r, backoffMs));
        }

        if (!mistralRes.ok) {
            const errorData = await mistralRes.json().catch(() => ({}));
            const status = mistralRes.status;
            const errMsg = status === 429
                ? 'Rate limit reached — please wait a moment and try again.'
                : status === 504
                ? 'Request timed out — try a shorter message or start a new session.'
                : (errorData.message || `Mistral API error (${status})`);
            return res.status(status).json({ error: errMsg });
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




