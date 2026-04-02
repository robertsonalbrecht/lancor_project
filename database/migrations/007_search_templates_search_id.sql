-- ============================================================================
-- Migration 007: Add search_id to search_templates for per-search kit items
-- ============================================================================

ALTER TABLE search_templates ADD COLUMN search_id UUID REFERENCES searches(id) ON DELETE CASCADE;
CREATE INDEX idx_search_templates_search_id ON search_templates(search_id);
