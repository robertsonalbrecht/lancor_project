'use strict';

/**
 * 009_firm_roster_backfill.js
 *
 * Backfill firm_roster + search_firm_review from the now-deprecated
 * coverage_firm_roster_deprecated table. Also copies firm verification
 * timestamps from search_coverage_firms into companies.roster_last_verified.
 *
 * Run AFTER 009_firm_roster.sql has been applied.
 *
 * Idempotent: re-running will not duplicate rows because firm_roster has a
 * partial unique index on (company_id, candidate_id) and search_firm_review
 * has a unique constraint on (search_id, firm_roster_id). Manual rows
 * (null candidate_id) are deduped by lower(name) within a company.
 *
 * Usage:
 *   node database/migrations/009_firm_roster_backfill.js
 *   node database/migrations/009_firm_roster_backfill.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pool = require('../../server/db');

const dryRun = process.argv.includes('--dry-run');

function log(msg) { console.log(msg); }

async function main() {
  log('═══════════════════════════════════════════════════════════');
  log(`  firm_roster backfill ${dryRun ? '(DRY RUN)' : ''}`);
  log('═══════════════════════════════════════════════════════════');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Pre-migration counts ────────────────────────────────────────────
    const { rows: [{ count: deprecatedCount }] } = await client.query(
      'SELECT COUNT(*)::int AS count FROM coverage_firm_roster_deprecated'
    );
    const { rows: [{ count: distinctPairsCount }] } = await client.query(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT DISTINCT scf.company_id, cfrd.candidate_id
         FROM coverage_firm_roster_deprecated cfrd
         JOIN search_coverage_firms scf ON scf.id = cfrd.coverage_firm_id
         WHERE cfrd.candidate_id IS NOT NULL
       ) AS d`
    );
    log(`  coverage_firm_roster_deprecated rows: ${deprecatedCount}`);
    log(`  distinct (company_id, candidate_id) pairs (non-null): ${distinctPairsCount}`);

    // ── Step 1: Backfill firm_roster from rows with non-null candidate_id ──
    log('');
    log('Step 1: Backfilling firm_roster (linked candidates)...');
    const { rows: linkedInsert } = await client.query(`
      INSERT INTO firm_roster (company_id, candidate_id, name, title, linkedin_url, location, roster_status, source, created_at, updated_at)
      SELECT DISTINCT ON (scf.company_id, cfrd.candidate_id)
        scf.company_id,
        cfrd.candidate_id,
        cfrd.name,
        cfrd.title,
        cfrd.linkedin_url,
        cfrd.location,
        COALESCE(cfrd.roster_status, 'Identified') AS roster_status,
        COALESCE(cfrd.source, 'auto-linked') AS source,
        cfrd.created_at,
        cfrd.updated_at
      FROM coverage_firm_roster_deprecated cfrd
      JOIN search_coverage_firms scf ON scf.id = cfrd.coverage_firm_id
      WHERE cfrd.candidate_id IS NOT NULL
      ORDER BY scf.company_id, cfrd.candidate_id, cfrd.updated_at DESC
      ON CONFLICT (company_id, candidate_id) WHERE candidate_id IS NOT NULL DO NOTHING
      RETURNING id
    `);
    log(`  ✓ inserted ${linkedInsert.length} linked rows`);

    // ── Step 2: Backfill firm_roster from manual rows (null candidate_id) ──
    // Dedupe by (company_id, lower(name))
    log('');
    log('Step 2: Backfilling firm_roster (manual entries, deduped by name)...');
    const { rows: manualInsert } = await client.query(`
      INSERT INTO firm_roster (company_id, candidate_id, name, title, linkedin_url, location, roster_status, source, created_at, updated_at)
      SELECT DISTINCT ON (scf.company_id, LOWER(cfrd.name))
        scf.company_id,
        NULL::uuid,
        cfrd.name,
        cfrd.title,
        cfrd.linkedin_url,
        cfrd.location,
        COALESCE(cfrd.roster_status, 'Identified') AS roster_status,
        COALESCE(cfrd.source, 'manual') AS source,
        cfrd.created_at,
        cfrd.updated_at
      FROM coverage_firm_roster_deprecated cfrd
      JOIN search_coverage_firms scf ON scf.id = cfrd.coverage_firm_id
      WHERE cfrd.candidate_id IS NULL
      ORDER BY scf.company_id, LOWER(cfrd.name), cfrd.updated_at DESC
      RETURNING id
    `);
    log(`  ✓ inserted ${manualInsert.length} manual rows`);

    // ── Step 3: Backfill search_firm_review (with dedup) ──
    // The deprecated table can contain multiple rows for the same person on
    // the same firm within the same search. Collapse by (search_id, firm_roster_id)
    // with tiebreak: 'relevant' > 'not_relevant' > null, then most recent reviewed_at.
    log('');
    log('Step 3: Backfilling search_firm_review (per-search overlay, deduped)...');

    // First count how many candidate rows we'd produce before dedup
    const { rows: [{ count: preDedupCount }] } = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM coverage_firm_roster_deprecated cfrd
      JOIN search_coverage_firms scf ON scf.id = cfrd.coverage_firm_id
      JOIN firm_roster fr ON
        fr.company_id = scf.company_id
        AND (
          (cfrd.candidate_id IS NOT NULL AND fr.candidate_id = cfrd.candidate_id)
          OR (cfrd.candidate_id IS NULL AND fr.candidate_id IS NULL AND LOWER(fr.name) = LOWER(cfrd.name))
        )
    `);

    const { rows: reviewInsert } = await client.query(`
      WITH joined AS (
        SELECT
          scf.search_id,
          fr.id AS firm_roster_id,
          cfrd.review_status,
          cfrd.reviewed_date AS reviewed_at,
          cfrd.created_at,
          cfrd.updated_at
        FROM coverage_firm_roster_deprecated cfrd
        JOIN search_coverage_firms scf ON scf.id = cfrd.coverage_firm_id
        JOIN firm_roster fr ON
          fr.company_id = scf.company_id
          AND (
            (cfrd.candidate_id IS NOT NULL AND fr.candidate_id = cfrd.candidate_id)
            OR (cfrd.candidate_id IS NULL AND fr.candidate_id IS NULL AND LOWER(fr.name) = LOWER(cfrd.name))
          )
      ),
      ranked AS (
        SELECT
          search_id,
          firm_roster_id,
          review_status,
          reviewed_at,
          created_at,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY search_id, firm_roster_id
            ORDER BY
              CASE
                WHEN review_status = 'relevant' THEN 2
                WHEN review_status = 'not_relevant' THEN 1
                ELSE 0
              END DESC,
              reviewed_at DESC NULLS LAST,
              updated_at DESC NULLS LAST
          ) AS rn
        FROM joined
      )
      INSERT INTO search_firm_review (search_id, firm_roster_id, review_status, reviewed_at, reviewed_by, created_at, updated_at)
      SELECT
        search_id,
        firm_roster_id,
        review_status,
        reviewed_at,
        NULL AS reviewed_by,
        created_at,
        updated_at
      FROM ranked
      WHERE rn = 1
      ON CONFLICT (search_id, firm_roster_id) DO UPDATE SET
        review_status = EXCLUDED.review_status,
        reviewed_at = EXCLUDED.reviewed_at,
        reviewed_by = EXCLUDED.reviewed_by
      RETURNING id
    `);
    const collapsedCount = preDedupCount - reviewInsert.length;
    log(`  ✓ inserted ${reviewInsert.length} review rows`);
    log(`  ⓘ collapsed ${collapsedCount} duplicate rows (same person on same firm within same search)`);

    // ── Step 4: Backfill firm-level verification timestamps ──
    log('');
    log('Step 4: Backfilling companies.roster_last_verified...');
    const { rowCount: verifiedUpdates } = await client.query(`
      WITH latest_per_company AS (
        SELECT DISTINCT ON (company_id)
          company_id,
          last_verified,
          verified_by
        FROM search_coverage_firms
        WHERE last_verified IS NOT NULL
        ORDER BY company_id, last_verified DESC
      )
      UPDATE companies c
      SET roster_last_verified = lpc.last_verified,
          roster_verified_by = lpc.verified_by
      FROM latest_per_company lpc
      WHERE c.id = lpc.company_id
    `);
    log(`  ✓ updated ${verifiedUpdates} company rows with last_verified`);

    // ── Validation checks ──
    log('');
    log('═══════════════════════════════════════════════════════════');
    log('  Validation checks');
    log('═══════════════════════════════════════════════════════════');

    const { rows: [{ count: firmRosterCount }] } = await client.query(
      'SELECT COUNT(*)::int AS count FROM firm_roster'
    );
    const { rows: [{ count: reviewCount }] } = await client.query(
      'SELECT COUNT(*)::int AS count FROM search_firm_review'
    );
    const { rows: [{ count: companiesWithVerifiedDeprecated }] } = await client.query(`
      SELECT COUNT(DISTINCT company_id)::int AS count
      FROM search_coverage_firms
      WHERE last_verified IS NOT NULL
    `);
    const { rows: [{ count: companiesWithVerifiedNew }] } = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM companies
      WHERE roster_last_verified IS NOT NULL
    `);

    log(`  firm_roster row count:                  ${firmRosterCount}`);
    log(`  search_firm_review row count:           ${reviewCount}`);
    log(`  coverage_firm_roster_deprecated count:  ${deprecatedCount}`);
    log(`  companies with verified (deprecated):   ${companiesWithVerifiedDeprecated}`);
    log(`  companies with roster_last_verified:    ${companiesWithVerifiedNew}`);
    log('');

    let ok = true;

    // Check 1: firm_roster <= distinct (company, candidate) pairs (non-null)
    //          plus distinct (company, lower(name)) for manual rows
    const { rows: [{ count: distinctManualCount }] } = await client.query(`
      SELECT COUNT(*)::int AS count FROM (
        SELECT DISTINCT scf.company_id, LOWER(cfrd.name) AS lname
        FROM coverage_firm_roster_deprecated cfrd
        JOIN search_coverage_firms scf ON scf.id = cfrd.coverage_firm_id
        WHERE cfrd.candidate_id IS NULL
      ) AS d
    `);
    const expectedMaxFirmRoster = distinctPairsCount + distinctManualCount;
    if (firmRosterCount <= expectedMaxFirmRoster) {
      log(`  ✓ Check 1 PASS: firm_roster (${firmRosterCount}) <= expected max (${expectedMaxFirmRoster})`);
    } else {
      log(`  ✗ Check 1 FAIL: firm_roster (${firmRosterCount}) > expected max (${expectedMaxFirmRoster})`);
      ok = false;
    }

    // Check 2: search_firm_review row count == deduped insert count from Step 3
    const expectedReviewCount = reviewInsert.length;
    log(`  duplicates collapsed in Step 3:         ${collapsedCount}`);
    if (reviewCount === expectedReviewCount) {
      log(`  ✓ Check 2 PASS: search_firm_review (${reviewCount}) == deduped rows (${expectedReviewCount})`);
    } else {
      log(`  ✗ Check 2 FAIL: search_firm_review (${reviewCount}) != deduped rows (${expectedReviewCount})`);
      ok = false;
    }

    // Check 3: every company that had a verified row now has roster_last_verified
    if (companiesWithVerifiedNew >= companiesWithVerifiedDeprecated) {
      log(`  ✓ Check 3 PASS: ${companiesWithVerifiedNew} companies have roster_last_verified (>= ${companiesWithVerifiedDeprecated} expected)`);
    } else {
      log(`  ✗ Check 3 FAIL: only ${companiesWithVerifiedNew} companies have roster_last_verified (expected >= ${companiesWithVerifiedDeprecated})`);
      ok = false;
    }

    log('');
    if (dryRun) {
      log('  DRY RUN — rolling back all changes.');
      await client.query('ROLLBACK');
    } else if (ok) {
      log('  All checks passed. Committing.');
      await client.query('COMMIT');
    } else {
      log('  Validation failed — rolling back.');
      await client.query('ROLLBACK');
      process.exitCode = 1;
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during backfill:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
