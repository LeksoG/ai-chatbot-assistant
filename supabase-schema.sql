-- ============================================================
-- Clarity AI — Supabase Schema
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard → your project → SQL Editor
-- ============================================================

-- Users profile table (stores names + 2FA flag alongside Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY,  -- matches Supabase Auth user UUID
    email         TEXT        NOT NULL UNIQUE,
    first_name    TEXT        DEFAULT '',
    last_name     TEXT        DEFAULT '',
    two_fa_enabled BOOLEAN    DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_users" ON users FOR ALL USING (true) WITH CHECK (true);

-- 2FA codes table (temporary codes sent by email on login)
CREATE TABLE IF NOT EXISTS two_fa_codes (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      UUID        NOT NULL,
    email        TEXT        NOT NULL,
    code         TEXT        NOT NULL,
    access_token TEXT        NOT NULL DEFAULT '',
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_two_fa_codes_user_id ON two_fa_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_two_fa_codes_expires_at ON two_fa_codes(expires_at);

ALTER TABLE two_fa_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_two_fa_codes" ON two_fa_codes FOR ALL USING (true) WITH CHECK (true);

-- Conversations table
CREATE TABLE conversations (
    id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       TEXT        NOT NULL,
    title         TEXT        NOT NULL,
    model_version TEXT        DEFAULT '3.0',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);

-- Enable Row Level Security (required for Supabase)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow all operations (our server uses the service_role key which bypasses RLS)
CREATE POLICY "service_all_conversations" ON conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_messages"      ON messages      FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- After running this SQL, add these to your Vercel env vars:
--   SUPABASE_URL          → Project Settings → API → Project URL
--   SUPABASE_SERVICE_KEY  → Project Settings → API → service_role secret
-- ============================================================

