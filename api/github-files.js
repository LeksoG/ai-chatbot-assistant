module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-github-token');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const token = req.headers['x-github-token'];
    if (!token) return res.status(401).json({ error: 'GitHub token required' });

    const ghHeaders = {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'ClarityAI/1.0',
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
        if (req.method === 'GET') {
            const { action, owner, repo, path } = req.query;

            // List user repositories
            if (action === 'repos') {
                const r = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator', { headers: ghHeaders });
                if (!r.ok) return res.status(r.status).json({ error: 'Failed to fetch repos' });
                const repos = await r.json();
                return res.json(repos.map(r => ({ full_name: r.full_name, private: r.private, description: r.description || '' })));
            }

            // List repo file tree (flat)
            if (action === 'tree' && owner && repo) {
                const branch = req.query.branch || 'main';
                let r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers: ghHeaders });
                if (!r.ok) {
                    // Fallback to master
                    r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`, { headers: ghHeaders });
                }
                if (!r.ok) return res.status(r.status).json({ error: 'Failed to fetch file tree' });
                const data = await r.json();
                const files = (data.tree || [])
                    .filter(f => f.type === 'blob' && f.path && !f.path.startsWith('.') && !f.path.includes('node_modules'))
                    .map(f => f.path);
                return res.json(files);
            }

            // Read file contents
            if (action === 'file' && owner && repo && path) {
                const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: ghHeaders });
                if (!r.ok) return res.status(r.status).json({ error: 'File not found' });
                const data = await r.json();
                const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
                return res.json({ content, sha: data.sha });
            }

            return res.status(400).json({ error: 'Unknown action. Use: repos, file' });
        }

        if (req.method === 'POST') {
            const { action, owner, repo, path, content, message } = req.body || {};

            if (action === 'commit') {
                if (!owner || !repo || !path || content === undefined) {
                    return res.status(400).json({ error: 'owner, repo, path, and content are required' });
                }

                // Get existing file SHA (needed for updates)
                let sha;
                try {
                    const checkR = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: ghHeaders });
                    if (checkR.ok) { const d = await checkR.json(); sha = d.sha; }
                } catch (_) {}

                const body = {
                    message: message || 'Update via Clarity Coding',
                    content: Buffer.from(content).toString('base64'),
                    ...(sha ? { sha } : {})
                };

                const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
                    method:  'PUT',
                    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
                    body:    JSON.stringify(body)
                });

                if (!r.ok) {
                    const errData = await r.json().catch(() => ({}));
                    return res.status(r.status).json({ error: errData.message || 'Commit failed' });
                }

                const data = await r.json();
                return res.json({ success: true, url: data.content?.html_url });
            }

            return res.status(400).json({ error: 'Unknown action. Use: commit' });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

