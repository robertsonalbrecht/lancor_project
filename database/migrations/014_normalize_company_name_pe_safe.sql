-- ─── Tighten normalize_company_name() for PE-heavy data ────────────────────
-- The original (013) stripped words like "Capital", "Partners", "Holdings",
-- "Group", "Ventures", "Management" — but those are core brand components in
-- private equity, not generic suffixes. "Bain Capital" is not "Bain";
-- "Three Hills Capital" is not "Three Hills". Stripping them caused
-- distinct firms to collapse together in the duplicate review.
--
-- This migration redefines the function to only strip pure legal-entity
-- markers (LLC, Inc., Corp., Ltd., GmbH, etc.). Brand-bearing words stay.

CREATE OR REPLACE FUNCTION normalize_company_name(input TEXT)
RETURNS TEXT AS $$
DECLARE
    result   TEXT;
    previous TEXT;
    -- Pure legal-entity suffixes only — no brand-distinguishing words.
    -- "Co" / "Company" left out as well: brand component too often
    -- ("The Boston Beer Company", "Walt Disney Company").
    suffix_pattern TEXT := '\s*[,.]?\s*\m(llc|l\.l\.c\.?|lllp|llp|l\.p\.?|lp|inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|gmbh|nv|bv|s\.?a\.?s?|plc|pty)\.?\s*$';
BEGIN
    IF input IS NULL THEN
        RETURN '';
    END IF;
    result := lower(trim(input));
    -- Iterate in case multiple legal markers stack ("Foo, Inc., LLC").
    FOR i IN 1..6 LOOP
        previous := result;
        result := trim(regexp_replace(result, suffix_pattern, '', 'i'));
        EXIT WHEN result = previous OR result = '';
    END LOOP;
    -- Empty result: the original was just a suffix. Fall back to the
    -- lowercased original — better to compare than to return nothing.
    IF result = '' THEN
        result := lower(trim(input));
    END IF;
    -- Replace internal punctuation with spaces, collapse whitespace, so
    -- the trigram tokenizer sees clean word boundaries.
    result := regexp_replace(result, '[[:punct:]]+', ' ', 'g');
    result := regexp_replace(result, '\s+', ' ', 'g');
    RETURN trim(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- The expression index is built on the function output. Postgres doesn't
-- automatically rebuild expression indexes when an IMMUTABLE function's
-- definition changes, so reindex it now to align with the new logic.
REINDEX INDEX idx_companies_name_normalized_trgm;
