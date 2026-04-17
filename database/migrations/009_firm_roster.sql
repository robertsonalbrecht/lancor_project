-- ════════════════════════════════════════════════════════════════════════════
-- Firm-level roster (global, shared across searches)
-- Replaces per-search coverage_firm_roster snapshots.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE firm_roster (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    candidate_id    UUID REFERENCES candidates(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    title           TEXT,
    linkedin_url    TEXT,
    location        TEXT,
    roster_status   TEXT DEFAULT 'Identified',               -- 'Identified' | 'Contacted' | etc.
    source          TEXT,                                    -- 'auto-linked' | 'manual' | 'playbook-import'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (firm, candidate) when linked to candidate pool.
-- Manual rows (null candidate_id) are not constrained here — handled by app logic.
CREATE UNIQUE INDEX firm_roster_company_candidate_uq
    ON firm_roster (company_id, candidate_id)
    WHERE candidate_id IS NOT NULL;

CREATE INDEX idx_firm_roster_company ON firm_roster(company_id);
CREATE INDEX idx_firm_roster_candidate ON firm_roster(candidate_id) WHERE candidate_id IS NOT NULL;

CREATE TRIGGER trg_firm_roster_updated_at
    BEFORE UPDATE ON firm_roster
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Per-search review overlay (relevant/not_relevant decisions per engagement)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE search_firm_review (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id       UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    firm_roster_id  UUID NOT NULL REFERENCES firm_roster(id) ON DELETE CASCADE,
    review_status   TEXT,                                    -- 'relevant' | 'not_relevant' | NULL
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (search_id, firm_roster_id)
);

CREATE INDEX idx_search_firm_review_search ON search_firm_review(search_id);
CREATE INDEX idx_search_firm_review_firm_roster ON search_firm_review(firm_roster_id);

CREATE TRIGGER trg_search_firm_review_updated_at
    BEFORE UPDATE ON search_firm_review
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Firm-level verification fields on companies
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE companies
    ADD COLUMN roster_last_verified  TIMESTAMPTZ,
    ADD COLUMN roster_verified_by    TEXT,
    ADD COLUMN roster_verified_note  TEXT;

-- ════════════════════════════════════════════════════════════════════════════
-- Preserve original per-search roster table under deprecated name
-- (will be dropped in a future migration once all routes are migrated)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE coverage_firm_roster RENAME TO coverage_firm_roster_deprecated;
