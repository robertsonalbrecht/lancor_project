-- ─── Company duplicate detection + merge support ───────────────────────────
-- Enables fuzzy name matching for the Company Pool's "Possible duplicates"
-- review and provides a place to remember which pairs the user has dismissed.

-- pg_trgm gives us similarity(a, b) on text and the % operator backed by GIN.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on companies.name for fast trigram lookups. The %-operator and
-- similarity() function both use this.
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
    ON companies USING GIN (name gin_trgm_ops);

-- Pairs the user has explicitly marked "not a duplicate" so they stop
-- showing up in the review queue. Stored ordered (a_id < b_id) so each
-- pair has exactly one row regardless of which side we saw first.
CREATE TABLE IF NOT EXISTS company_duplicate_ignored (
    a_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    b_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ignored_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id < b_id)
);
