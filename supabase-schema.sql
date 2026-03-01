-- ============================================================
-- Clarity AI — Supabase Schema  (run in SQL Editor)
-- https://supabase.com/dashboard → project → SQL Editor
-- ============================================================

-- ── User profiles (extends Supabase auth.users) ───────────
CREATE TABLE IF NOT EXISTS users (
    id             UUID        PRIMARY KEY,   -- same as auth.users.id
    email          TEXT        NOT NULL UNIQUE,
    first_name     TEXT        NOT NULL DEFAULT '',
    last_name      TEXT        NOT NULL DEFAULT '',
    two_fa_enabled BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Temporary 2FA codes (expire after 10 min) ─────────────
CREATE TABLE IF NOT EXISTS two_fa_codes (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email        TEXT        NOT NULL,
    code         TEXT        NOT NULL,
    access_token TEXT        NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Conversations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
    id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       TEXT        NOT NULL,
    title         TEXT        NOT NULL,
    model_version TEXT        NOT NULL DEFAULT '3.0',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Messages ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_user_id   ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated   ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation   ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_two_fa_codes_user       ON two_fa_codes(user_id);

-- ── Row Level Security ────────────────────────────────────
-- (server uses service_role key which bypasses RLS, but enable for safety)
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE two_fa_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_users"    ON users          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_2fa"      ON two_fa_codes   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_convs"    ON conversations  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_msgs"     ON messages       FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- After running this, add these env vars in Vercel:
--   SUPABASE_URL          → Project Settings → API → Project URL
--   SUPABASE_SERVICE_KEY  → Project Settings → API → service_role secret
--
-- For 2FA email (optional):
--   EMAILJS_SERVICE_ID    → EmailJS dashboard → Email Services
--   EMAILJS_TEMPLATE_ID   → EmailJS dashboard → Email Templates
--   EMAILJS_PUBLIC_KEY    → EmailJS dashboard → Account → Public Key
--   EMAILJS_PRIVATE_KEY   → EmailJS dashboard → Account → Private Key
-- ============================================================
