-- ============================================================================
-- Lancor Search OS — PostgreSQL Schema
-- Migration from JSON flat-file storage
-- Generated 2026-03-29
--
-- Conventions:
--   - All PKs are UUID via gen_random_uuid()
--   - Original slug IDs preserved as TEXT UNIQUE columns
--   - All dates are TIMESTAMPTZ
--   - Every table has created_at / updated_at
--   - Nested arrays that represent relationships are separate tables
--   - PE-specific fields live as nullable columns on the companies table
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTORS
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE sectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,                    -- original sector_id e.g. 'industrials'
    sector_name     TEXT NOT NULL,
    build_status    TEXT NOT NULL DEFAULT 'partial',         -- 'partial' | 'complete'
    last_updated    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global ordered list of roster titles used for roster mapping defaults
CREATE TABLE roster_titles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- COMPANIES  (unified: PE firms, portfolio companies, public companies, etc.)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE companies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    TEXT NOT NULL UNIQUE,            -- original company_id
    company_type            TEXT,                            -- 'PE Firm', 'Portfolio Company', 'Public Company', etc.
    name                    TEXT NOT NULL,
    hq                      TEXT,
    website_url             TEXT,
    linkedin_company_url    TEXT,
    description             TEXT,
    year_founded            INTEGER,
    notes                   TEXT DEFAULT '',
    source                  TEXT,                            -- e.g. 'pitchbook-companies', 'playbook-seed'
    enrichment_status       TEXT,                            -- e.g. 'enriched'

    -- Industry classification
    industry                TEXT,
    industry_sector         TEXT,
    gecs_sector             TEXT,
    gecs_industry_group     TEXT,
    gecs_industry           TEXT,
    pb_industry_sector      TEXT,
    pb_industry_group       TEXT,
    pb_industry_code        TEXT,

    -- Financials & company info
    employee_count          INTEGER,
    revenue_tier            TEXT,                            -- e.g. '$50M-$200M'
    revenue_millions        NUMERIC(12,2),
    ownership_type          TEXT,                            -- e.g. 'PE-backed', 'Public'
    ticker                  TEXT,
    parent_company          TEXT,
    pe_sponsors             TEXT,
    competitors             TEXT,
    employee_history        TEXT,                            -- e.g. '2016: 490, 2020: 700, ...'
    keywords                TEXT,
    verticals               TEXT,

    -- PE-specific fields (nullable — only populated for PE firms)
    size_tier               TEXT,                            -- e.g. 'Mega', 'Middle Market'
    strategy                TEXT,                            -- e.g. 'Buyout', 'Growth Equity'
    entity_type             TEXT,                            -- e.g. 'Dedicated PE Firm', 'Asset Manager with PE Wing'
    ownership_status        TEXT,
    investment_professionals INTEGER,
    last_fund_name          TEXT,
    last_fund_size          NUMERIC(12,2),                   -- in millions
    last_fund_vintage       INTEGER,
    dry_powder              NUMERIC(14,2),                   -- in millions
    preferred_ebitda_min    NUMERIC(12,2),                   -- in millions
    preferred_ebitda_max    NUMERIC(12,2),                   -- in millions
    preferred_geography     TEXT,
    last_investment_date    TIMESTAMPTZ,
    investments_last_2yr    INTEGER,
    active_portfolio_count  INTEGER,

    -- Migration timestamps (from JSON data)
    date_added              TIMESTAMPTZ,
    last_updated            TIMESTAMPTZ,

    -- System timestamps
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Company aliases (e.g. "11:11" for "11:11 Systems")
CREATE TABLE company_aliases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    alias           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, alias)
);

-- Company ↔ Sector many-to-many (from sector_focus_tags)
CREATE TABLE company_sector_tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sector_id       UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, sector_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- CANDIDATES  (master candidate pool)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE candidates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    TEXT NOT NULL UNIQUE,            -- original candidate_id
    name                    TEXT NOT NULL,
    current_title           TEXT,
    current_firm            TEXT,
    home_location           TEXT,
    linkedin_url            TEXT,
    archetype               TEXT,                            -- 'PE Lateral', 'Industry Operator', etc.
    operator_background     TEXT[] DEFAULT '{}',
    firm_size_tier          TEXT,
    company_revenue_tier    TEXT,
    quality_rating          INTEGER,
    rating_set_by           TEXT,
    rating_date             TIMESTAMPTZ,
    availability            TEXT DEFAULT 'Unknown',
    availability_updated    TIMESTAMPTZ,
    last_contact_date       TIMESTAMPTZ,
    notes                   TEXT DEFAULT '',
    date_added              TIMESTAMPTZ,
    added_from_search       TEXT DEFAULT '',
    owned_pl                BOOLEAN NOT NULL DEFAULT FALSE,  -- proprietary lead
    dq_reasons              TEXT[] DEFAULT '{}',
    primary_experience_index INTEGER,                        -- index into work history
    last_scraped            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Candidate ↔ Sector many-to-many (from sector_tags)
CREATE TABLE candidate_sector_tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    sector_id       UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (candidate_id, sector_id)
);

-- Candidate work history entries
CREATE TABLE candidate_work_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,   -- link to company pool
    title           TEXT,
    company_name    TEXT,                                    -- denormalized company name
    dates           TEXT,                                    -- e.g. 'Present'
    date_range      TEXT,
    duration        TEXT,
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,          -- mirrors primary_experience_index
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (candidate_id, sort_order)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SEARCHES  (active recruiting engagements)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE searches (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    TEXT NOT NULL UNIQUE,            -- original search_id
    client_name             TEXT NOT NULL,
    role_title              TEXT,
    status                  TEXT NOT NULL DEFAULT 'active',
    lead_recruiter          TEXT,
    ideal_candidate_profile TEXT DEFAULT '',
    archetypes_requested    TEXT[] DEFAULT '{}',             -- e.g. {'PE Lateral','Industry Operator'}
    date_opened             TIMESTAMPTZ,
    date_closed             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Search ↔ Sector many-to-many
CREATE TABLE search_sectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id       UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    sector_id       UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (search_id, sector_id)
);

-- Client-side stakeholders per search
CREATE TABLE search_client_contacts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id           UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    abbreviation        TEXT,
    display_in_matrix   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lancor team members assigned to a search
CREATE TABLE search_lancor_team (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id       UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    initials        TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    role            TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Candidate ↔ Search history (which searches a candidate has appeared in)
CREATE TABLE candidate_search_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    search_id       UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (candidate_id, search_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- SEARCH PIPELINE  (candidates moving through a search funnel)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE search_pipeline (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id           UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    -- Snapshot fields (denormalized from candidate at time of addition)
    name                TEXT,
    current_title       TEXT,
    current_firm        TEXT,
    location            TEXT,
    linkedin_url        TEXT,
    archetype           TEXT,
    source              TEXT,                                -- how they were found
    -- Pipeline tracking
    stage               TEXT NOT NULL DEFAULT 'Pursuing',    -- 'Pursuing','Screen Scheduled','Presented','DQ', etc.
    lancor_screener     TEXT DEFAULT '',
    screen_date         TIMESTAMPTZ,
    lancor_assessment   TEXT DEFAULT '',
    resume_attached     BOOLEAN NOT NULL DEFAULT FALSE,
    client_feedback     TEXT DEFAULT '',
    next_step           TEXT DEFAULT '',
    next_step_owner     TEXT DEFAULT '',
    next_step_date      TIMESTAMPTZ,
    dq_reason           TEXT DEFAULT '',
    last_touchpoint     TIMESTAMPTZ,
    notes               TEXT DEFAULT '',
    date_added          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (search_id, candidate_id)
);

-- Client meetings per pipeline entry (one row per client contact)
CREATE TABLE pipeline_client_meetings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_entry_id   UUID NOT NULL REFERENCES search_pipeline(id) ON DELETE CASCADE,
    contact_name        TEXT NOT NULL,
    status              TEXT DEFAULT '—',                    -- e.g. '—', 'Scheduled', 'Completed'
    meeting_date        TIMESTAMPTZ,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTOR PLAYBOOKS  (master firm/company lists per sector)
-- ════════════════════════════════════════════════════════════════════════════

-- PE firms assigned to a sector playbook
CREATE TABLE sector_pe_firms (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id               UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- Playbook-specific metadata (may diverge from company pool)
    name                    TEXT,
    hq                      TEXT,
    size_tier               TEXT,
    strategy                TEXT,
    sector_focus            TEXT,
    why_target              TEXT DEFAULT '',
    expected_roster_size    INTEGER,
    custom_roster_size      INTEGER,
    roster_completeness     TEXT DEFAULT 'auto',             -- 'auto' | 'manual'
    manual_complete_note    TEXT,
    last_roster_audit       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sector_id, company_id)
);

-- Target companies assigned to a sector playbook
CREATE TABLE sector_target_companies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id               UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- Playbook-specific metadata
    name                    TEXT,
    hq                      TEXT,
    revenue_tier            TEXT,
    ownership_type          TEXT,
    industry                TEXT,
    employee_count          INTEGER,
    pe_sponsors             TEXT,
    roles_to_target         TEXT,                            -- e.g. 'Division President, Group VP, COO'
    why_target              TEXT DEFAULT '',
    expected_roster_size    INTEGER,
    custom_roster_size      INTEGER,
    roster_completeness     TEXT DEFAULT 'auto',             -- 'auto' | 'manual'
    manual_complete_note    TEXT,
    last_roster_audit       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sector_id, company_id)
);

-- Prioritized "top companies" per sector (ordered subset of sector_target_companies)
CREATE TABLE sector_top_companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id       UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sector_id, company_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- PLAYBOOK ROSTERS  (people mapped at PE firms / target companies)
-- ════════════════════════════════════════════════════════════════════════════

-- Roster people on a playbook PE firm
CREATE TABLE playbook_firm_roster (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_pe_firm_id       UUID NOT NULL REFERENCES sector_pe_firms(id) ON DELETE CASCADE,
    candidate_id            UUID REFERENCES candidates(id) ON DELETE SET NULL,
    candidate_slug          TEXT,                            -- original candidate_id slug for migration
    name                    TEXT NOT NULL,
    title                   TEXT,
    linkedin_url            TEXT,
    roster_status           TEXT DEFAULT 'Identified',
    last_updated            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roster people on a playbook target company
CREATE TABLE playbook_company_roster (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_target_company_id    UUID NOT NULL REFERENCES sector_target_companies(id) ON DELETE CASCADE,
    candidate_id                UUID REFERENCES candidates(id) ON DELETE SET NULL,
    candidate_slug              TEXT,                        -- original candidate_id slug for migration
    name                        TEXT NOT NULL,
    title                       TEXT,
    linkedin_url                TEXT,
    roster_status               TEXT DEFAULT 'Identified',
    last_updated                TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- SOURCING COVERAGE  (per-search firm/company tracking)
-- ════════════════════════════════════════════════════════════════════════════

-- PE firms being sourced for a specific search
CREATE TABLE search_coverage_firms (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id               UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- Snapshot metadata
    name                    TEXT,
    hq                      TEXT,
    size_tier               TEXT,
    strategy                TEXT,
    sector_focus            TEXT,
    why_target              TEXT DEFAULT '',
    -- Completion tracking
    manual_complete         BOOLEAN NOT NULL DEFAULT FALSE,
    manual_complete_note    TEXT DEFAULT '',
    last_verified           TIMESTAMPTZ,
    verified_by             TEXT,
    archived_complete       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (search_id, company_id)
);

-- Companies being sourced for a specific search
CREATE TABLE search_coverage_companies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id               UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- Snapshot metadata
    name                    TEXT,
    hq                      TEXT,
    revenue_tier            TEXT,
    ownership_type          TEXT,
    why_target              TEXT DEFAULT '',
    -- Completion tracking
    manual_complete         BOOLEAN NOT NULL DEFAULT FALSE,
    manual_complete_note    TEXT DEFAULT '',
    last_verified           TIMESTAMPTZ,
    verified_by             TEXT,
    archived_complete       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (search_id, company_id)
);

-- Roster people on a coverage PE firm (per-search)
CREATE TABLE coverage_firm_roster (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coverage_firm_id    UUID NOT NULL REFERENCES search_coverage_firms(id) ON DELETE CASCADE,
    candidate_id        UUID REFERENCES candidates(id) ON DELETE SET NULL,
    candidate_slug      TEXT,                                -- original candidate_id slug for migration
    name                TEXT NOT NULL,
    title               TEXT,
    linkedin_url        TEXT,
    location            TEXT,
    roster_status       TEXT DEFAULT 'Identified',
    source              TEXT,                                -- e.g. 'auto-linked'
    reviewed            BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_date       TIMESTAMPTZ,
    review_status       TEXT,                                -- e.g. 'not_relevant'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roster people on a coverage target company (per-search)
CREATE TABLE coverage_company_roster (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coverage_company_id     UUID NOT NULL REFERENCES search_coverage_companies(id) ON DELETE CASCADE,
    candidate_id            UUID REFERENCES candidates(id) ON DELETE SET NULL,
    candidate_slug          TEXT,                            -- original candidate_id slug for migration
    name                    TEXT NOT NULL,
    title                   TEXT,
    linkedin_url            TEXT,
    location                TEXT,
    roster_status           TEXT DEFAULT 'Identified',
    source                  TEXT,
    reviewed                BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_date           TIMESTAMPTZ,
    review_status           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- TEMPLATES
-- ════════════════════════════════════════════════════════════════════════════

-- Outreach message templates (fully defined schema)
CREATE TABLE outreach_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,                    -- original template id
    name            TEXT NOT NULL,
    archetype       TEXT,                                    -- e.g. 'Operating Partner'
    channel         TEXT,                                    -- e.g. 'LinkedIn'
    subject         TEXT DEFAULT '',
    body            TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    created_date    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Generic templates for other types (boolean strings, pitchbook params, etc.)
CREATE TABLE search_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_type   TEXT NOT NULL,                           -- 'boolean_string', 'pitchbook_param',
                                                             -- 'ideal_candidate_profile', 'screen_question_guide'
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    content         TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    created_date    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════════════
-- ENRICHMENT PROGRESS
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE enrichment_progress (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'processed',       -- 'processed' | 'failed'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════════════════════

-- Companies
CREATE INDEX idx_companies_type ON companies(company_type);
CREATE INDEX idx_companies_name ON companies(name);
CREATE INDEX idx_companies_enrichment ON companies(enrichment_status);

-- Candidates
CREATE INDEX idx_candidates_name ON candidates(name);
CREATE INDEX idx_candidates_firm ON candidates(current_firm);
CREATE INDEX idx_candidates_archetype ON candidates(archetype);
CREATE INDEX idx_candidates_linkedin ON candidates(linkedin_url);

-- Searches
CREATE INDEX idx_searches_status ON searches(status);
CREATE INDEX idx_searches_client ON searches(client_name);

-- Pipeline
CREATE INDEX idx_pipeline_search ON search_pipeline(search_id);
CREATE INDEX idx_pipeline_candidate ON search_pipeline(candidate_id);
CREATE INDEX idx_pipeline_stage ON search_pipeline(stage);

-- Coverage
CREATE INDEX idx_cov_firms_search ON search_coverage_firms(search_id);
CREATE INDEX idx_cov_companies_search ON search_coverage_companies(search_id);
CREATE INDEX idx_cov_firm_roster_firm ON coverage_firm_roster(coverage_firm_id);
CREATE INDEX idx_cov_co_roster_co ON coverage_company_roster(coverage_company_id);

-- Playbook
CREATE INDEX idx_sector_pe_firms_sector ON sector_pe_firms(sector_id);
CREATE INDEX idx_sector_pe_firms_company ON sector_pe_firms(company_id);
CREATE INDEX idx_sector_target_cos_sector ON sector_target_companies(sector_id);
CREATE INDEX idx_sector_target_cos_company ON sector_target_companies(company_id);
CREATE INDEX idx_pb_firm_roster_firm ON playbook_firm_roster(sector_pe_firm_id);
CREATE INDEX idx_pb_co_roster_co ON playbook_company_roster(sector_target_company_id);

-- Work history
CREATE INDEX idx_work_history_candidate ON candidate_work_history(candidate_id);
CREATE INDEX idx_work_history_company ON candidate_work_history(company_id);

-- Junction tables
CREATE INDEX idx_search_sectors_search ON search_sectors(search_id);
CREATE INDEX idx_search_sectors_sector ON search_sectors(sector_id);
CREATE INDEX idx_company_sector_tags_company ON company_sector_tags(company_id);
CREATE INDEX idx_candidate_sector_tags_candidate ON candidate_sector_tags(candidate_id);

-- ════════════════════════════════════════════════════════════════════════════
-- TRIGGER: auto-update updated_at on row modification
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sectors_updated_at BEFORE UPDATE ON sectors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_roster_titles_updated_at BEFORE UPDATE ON roster_titles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_company_aliases_updated_at BEFORE UPDATE ON company_aliases FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_company_sector_tags_updated_at BEFORE UPDATE ON company_sector_tags FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_candidates_updated_at BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_candidate_sector_tags_updated_at BEFORE UPDATE ON candidate_sector_tags FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_candidate_work_history_updated_at BEFORE UPDATE ON candidate_work_history FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_searches_updated_at BEFORE UPDATE ON searches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_search_sectors_updated_at BEFORE UPDATE ON search_sectors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_search_client_contacts_updated_at BEFORE UPDATE ON search_client_contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_search_lancor_team_updated_at BEFORE UPDATE ON search_lancor_team FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_candidate_search_history_updated_at BEFORE UPDATE ON candidate_search_history FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_search_pipeline_updated_at BEFORE UPDATE ON search_pipeline FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pipeline_client_meetings_updated_at BEFORE UPDATE ON pipeline_client_meetings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sector_pe_firms_updated_at BEFORE UPDATE ON sector_pe_firms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sector_target_companies_updated_at BEFORE UPDATE ON sector_target_companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sector_top_companies_updated_at BEFORE UPDATE ON sector_top_companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_playbook_firm_roster_updated_at BEFORE UPDATE ON playbook_firm_roster FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_playbook_company_roster_updated_at BEFORE UPDATE ON playbook_company_roster FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_search_coverage_firms_updated_at BEFORE UPDATE ON search_coverage_firms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_search_coverage_companies_updated_at BEFORE UPDATE ON search_coverage_companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_coverage_firm_roster_updated_at BEFORE UPDATE ON coverage_firm_roster FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_coverage_company_roster_updated_at BEFORE UPDATE ON coverage_company_roster FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_outreach_messages_updated_at BEFORE UPDATE ON outreach_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_search_templates_updated_at BEFORE UPDATE ON search_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_enrichment_progress_updated_at BEFORE UPDATE ON enrichment_progress FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
