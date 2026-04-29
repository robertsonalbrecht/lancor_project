-- ─── Suffix-stripping normalizer for company-name fuzzy matching ────────────
-- Without this, names like "Palladium Equity" and "Palladium Equity Partners,
-- LLC" come out at ~55% trigram similarity because the suffix doubles the
-- string length without adding signal. The duplicate review uses the
-- normalized form so suffix-only differences score near 100%.

CREATE OR REPLACE FUNCTION normalize_company_name(input TEXT)
RETURNS TEXT AS $$
DECLARE
    result   TEXT;
    previous TEXT;
    -- Common corporate suffixes (US + a few international). Anchored at end
    -- of string so we only strip a trailing suffix, never a substring in
    -- the middle of a name.
    suffix_pattern TEXT := '\s*[,.]?\s*\m(llc|l\.l\.c\.?|lllp|llp|l\.p\.?|lp|inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|partners|partner|holdings|holding|group|ventures|capital|management|advisors|advisers|associates|gmbh|ag|nv|bv|s\.?a\.?s?|plc|pty)\.?\s*$';
BEGIN
    IF input IS NULL THEN
        RETURN '';
    END IF;
    result := lower(trim(input));
    -- Iterate: companies often stack suffixes ("Foo Capital Partners, LLC").
    -- Bounded loop so a pathological input can't spin.
    FOR i IN 1..8 LOOP
        previous := result;
        result := trim(regexp_replace(result, suffix_pattern, '', 'i'));
        EXIT WHEN result = previous OR result = '';
    END LOOP;
    -- If we stripped everything, fall back to the lowercased original — it's
    -- better to compare a punctuation-y string than nothing.
    IF result = '' THEN
        result := lower(trim(input));
    END IF;
    -- Replace internal punctuation with spaces and collapse whitespace so the
    -- trigram tokenizer sees clean word boundaries.
    result := regexp_replace(result, '[[:punct:]]+', ' ', 'g');
    result := regexp_replace(result, '\s+', ' ', 'g');
    RETURN trim(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Expression GIN index so similarity() / % operator on the normalized form
-- stays fast as the company pool grows.
CREATE INDEX IF NOT EXISTS idx_companies_name_normalized_trgm
    ON companies USING GIN (normalize_company_name(name) gin_trgm_ops);
