-- ─── Phase 1 of auth system ──────────────────────────────────────────────────
-- Adds: users, user_sessions, search_user_access
-- Alters: searches (adds visibility + created_by + updated_by)
-- Does NOT lock down any existing endpoint — runtime behavior unchanged until Phase 2.
-- Existing searches' created_by is backfilled by scripts/create-admin.js after
-- the first admin is created.

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'consultant'
                    CHECK (role IN ('admin', 'consultant', 'analyst')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users (is_active) WHERE is_active = TRUE;

-- ── user_sessions ────────────────────────────────────────────────────────────
-- Session token is the opaque cookie value; expires_at is the hard expiry.
CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token   TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    user_agent      TEXT,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);

-- ── search_user_access ───────────────────────────────────────────────────────
-- Explicit per-user access grants for private searches. Public searches don't
-- use this table — visibility check short-circuits.
CREATE TABLE IF NOT EXISTS search_user_access (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id       UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_level    TEXT NOT NULL DEFAULT 'view'
                    CHECK (access_level IN ('view', 'edit', 'admin')),
    granted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (search_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_search_user_access_user_id ON search_user_access (user_id);
CREATE INDEX IF NOT EXISTS idx_search_user_access_search_id ON search_user_access (search_id);

-- ── searches additions ───────────────────────────────────────────────────────
-- created_by stays nullable for now; the backfill step in create-admin.js fills
-- it for existing rows. A NOT NULL constraint can be added in a later migration
-- once all rows are backfilled and the app enforces it at insert time.
ALTER TABLE searches
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private')),
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_searches_created_by ON searches (created_by);
CREATE INDEX IF NOT EXISTS idx_searches_visibility ON searches (visibility);
