-- ============================================================
-- Clarity AI — Supabase Schema
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard → your project → SQL Editor
-- ============================================================

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

