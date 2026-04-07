-- ============================================================================
-- Migration 006: Structured dates on work history + CHECK constraints
-- ============================================================================

-- 1. Add structured date columns to candidate_work_history
ALTER TABLE candidate_work_history ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE candidate_work_history ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE candidate_work_history ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Backfill from the dates TEXT field
-- Parse patterns: "Jan 2020 - Present", "Jul 2014 - Jan 2022", "2020 - 2023"
UPDATE candidate_work_history
SET
  is_current = (dates ILIKE '%present%'),
  start_date = (
    SELECT CASE
      WHEN m[2] IS NOT NULL AND m[1] IS NOT NULL THEN
        make_date(m[2]::int, CASE LOWER(LEFT(m[1], 3))
          WHEN 'jan' THEN 1 WHEN 'feb' THEN 2 WHEN 'mar' THEN 3 WHEN 'apr' THEN 4
          WHEN 'may' THEN 5 WHEN 'jun' THEN 6 WHEN 'jul' THEN 7 WHEN 'aug' THEN 8
          WHEN 'sep' THEN 9 WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
          ELSE 1 END, 1)
      WHEN m[2] IS NOT NULL THEN make_date(m[2]::int, 1, 1)
      ELSE NULL
    END
    FROM regexp_match(split_part(split_part(dates, ' · ', 1), ' - ', 1), '(?:(\w+)\s+)?(\d{4})') AS m
  ),
  end_date = CASE WHEN dates ILIKE '%present%' THEN NULL ELSE (
    SELECT CASE
      WHEN m[2] IS NOT NULL AND m[1] IS NOT NULL THEN
        make_date(m[2]::int, CASE LOWER(LEFT(m[1], 3))
          WHEN 'jan' THEN 1 WHEN 'feb' THEN 2 WHEN 'mar' THEN 3 WHEN 'apr' THEN 4
          WHEN 'may' THEN 5 WHEN 'jun' THEN 6 WHEN 'jul' THEN 7 WHEN 'aug' THEN 8
          WHEN 'sep' THEN 9 WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
          ELSE 1 END, 1)
      WHEN m[2] IS NOT NULL THEN make_date(m[2]::int, 1, 1)
      ELSE NULL
    END
    FROM regexp_match(split_part(split_part(dates, ' · ', 1), ' - ', 2), '(?:(\w+)\s+)?(\d{4})') AS m
  ) END
WHERE dates IS NOT NULL AND dates != '';

-- 3. Index for date queries
CREATE INDEX IF NOT EXISTS idx_work_history_start_date ON candidate_work_history(start_date);
CREATE INDEX IF NOT EXISTS idx_work_history_is_current ON candidate_work_history(is_current) WHERE is_current = true;

-- 4. CHECK constraints on enum fields
ALTER TABLE sectors DROP CONSTRAINT IF EXISTS chk_sectors_build_status;
ALTER TABLE sectors ADD CONSTRAINT chk_sectors_build_status CHECK (build_status IN ('partial', 'complete'));

ALTER TABLE searches DROP CONSTRAINT IF EXISTS chk_searches_status;
ALTER TABLE searches ADD CONSTRAINT chk_searches_status CHECK (status IN ('active', 'open', 'closed'));

ALTER TABLE enrichment_progress DROP CONSTRAINT IF EXISTS chk_enrichment_status;
ALTER TABLE enrichment_progress ADD CONSTRAINT chk_enrichment_status CHECK (status IN ('processed', 'failed'));

ALTER TABLE search_templates DROP CONSTRAINT IF EXISTS chk_template_type;
ALTER TABLE search_templates ADD CONSTRAINT chk_template_type CHECK (template_type IN ('boolean_string', 'pitchbook_param', 'ideal_candidate_profile', 'screen_question_guide'));
