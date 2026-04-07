-- Add denormalized sector_slug for readability in Supabase table editor
ALTER TABLE candidate_sector_tags ADD COLUMN IF NOT EXISTS sector_slug TEXT;
ALTER TABLE company_sector_tags ADD COLUMN IF NOT EXISTS sector_slug TEXT;

-- Backfill from sectors table
UPDATE candidate_sector_tags cst SET sector_slug = s.slug FROM sectors s WHERE s.id = cst.sector_id AND cst.sector_slug IS NULL;
UPDATE company_sector_tags cst SET sector_slug = s.slug FROM sectors s WHERE s.id = cst.sector_id AND cst.sector_slug IS NULL;
