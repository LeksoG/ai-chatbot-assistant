-- ============================================================
-- Clarity AI — Supabase Schema
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard → your project → SQL Editor
-- ============================================================

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id       TEXT        NOT NULL,
    title         TEXT        NOT NULL,
    model_version TEXT        DEFAULT '3.0',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_conversations_user_id    ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Enable Row Level Security (required for Supabase)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;

-- Allow all operations (our server uses the service_role key which bypasses RLS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='conversations' AND policyname='service_all_conversations') THEN
    CREATE POLICY "service_all_conversations" ON conversations FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='messages' AND policyname='service_all_messages') THEN
    CREATE POLICY "service_all_messages" ON messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- User profiles table (stores display names and app settings)
CREATE TABLE IF NOT EXISTS users (
    id             TEXT        PRIMARY KEY,  -- matches auth.users id (UUID stored as text)
    email          TEXT,
    first_name     TEXT        DEFAULT '',
    last_name      TEXT        DEFAULT '',
    two_fa_enabled BOOLEAN     DEFAULT false,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='service_all_users') THEN
    CREATE POLICY "service_all_users" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Artifacts table (public — all users can view each other's artifacts)
CREATE TABLE IF NOT EXISTS artifacts (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     TEXT        NOT NULL,
    user_name   TEXT        NOT NULL DEFAULT 'Anonymous',
    title       TEXT        NOT NULL,
    description TEXT        DEFAULT '',
    code        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Drop slug column if it exists from a previous schema version
ALTER TABLE artifacts DROP COLUMN IF EXISTS slug;

CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_user_id    ON artifacts(user_id);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='artifacts' AND policyname='service_all_artifacts') THEN
    CREATE POLICY "service_all_artifacts" ON artifacts FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Gmail connections table (stores OAuth tokens per user)
CREATE TABLE IF NOT EXISTS gmail_connections (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     TEXT        NOT NULL UNIQUE,
    email       TEXT        NOT NULL,
    access_token  TEXT      NOT NULL,
    refresh_token TEXT      NOT NULL,
    token_expiry  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gmail_connections_user_id ON gmail_connections(user_id);

ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gmail_connections' AND policyname='service_all_gmail_connections') THEN
    CREATE POLICY "service_all_gmail_connections" ON gmail_connections FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Email conversations table (stores email sessions)
CREATE TABLE IF NOT EXISTS email_conversations (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    gmail_email TEXT        DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_conversations_user_id    ON email_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_email_conversations_updated_at ON email_conversations(updated_at DESC);

ALTER TABLE email_conversations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='email_conversations' AND policyname='service_all_email_conversations') THEN
    CREATE POLICY "service_all_email_conversations" ON email_conversations FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Email messages table (stores individual email thread messages)
CREATE TABLE IF NOT EXISTS email_messages (
    id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    email_conversation_id UUID      NOT NULL REFERENCES email_conversations(id) ON DELETE CASCADE,
    role                TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content             TEXT        NOT NULL,
    recipient           TEXT        DEFAULT '',
    subject             TEXT        DEFAULT '',
    is_sent             BOOLEAN     DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_conversation_id ON email_messages(email_conversation_id);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='email_messages' AND policyname='service_all_email_messages') THEN
    CREATE POLICY "service_all_email_messages" ON email_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- After running this SQL, add these to your Vercel env vars:
--   SUPABASE_URL          → Project Settings → API → Project URL
--   SUPABASE_SERVICE_KEY  → Project Settings → API → service_role secret
--   GOOGLE_CLIENT_ID      → Google Cloud Console → Credentials → OAuth 2.0 Client ID
--   GOOGLE_CLIENT_SECRET  → Google Cloud Console → Credentials → OAuth 2.0 Client Secret
-- ============================================================
