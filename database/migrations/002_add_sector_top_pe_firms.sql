CREATE TABLE sector_top_pe_firms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id   UUID NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sector_id, company_id)
);
CREATE INDEX idx_sector_top_pe_firms_sector ON sector_top_pe_firms(sector_id);
CREATE TRIGGER trg_sector_top_pe_firms_updated_at BEFORE UPDATE ON sector_top_pe_firms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
