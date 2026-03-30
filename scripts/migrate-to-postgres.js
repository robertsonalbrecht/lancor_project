#!/usr/bin/env node
// ============================================================================
// Lancor Search OS — JSON → Postgres Migration Script
//
// Reads all JSON files from data/ (read-only) and inserts into Postgres.
// Safe to run multiple times: uses ON CONFLICT DO NOTHING for slug-keyed tables.
//
// Usage:  npm install pg  (if not already installed)
//         node scripts/migrate-to-postgres.js
// ============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  console.log(`\n📂 Loading ${filename}...`);
  const raw = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(raw);
}

/** Convert a date string (or null) to a value Postgres accepts as TIMESTAMPTZ */
function toTS(val) {
  if (!val) return null;
  // Already an ISO string or date-only string — pg driver handles both
  return val;
}

/** Coerce a value that might be a string or array into a TEXT[] for Postgres */
function toTextArray(val) {
  if (!val) return '{}';
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.length > 0) return [val];
  return '{}';
}

// ── Main migration ──────────────────────────────────────────────────────────

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // UUID lookup maps:  slug → UUID
  const sectorMap   = {};  // sector slug → uuid
  const companyMap   = {};  // company slug → uuid
  const candidateMap = {};  // candidate slug → uuid
  const searchMap    = {};  // search slug → uuid

  // Composite-key lookup maps for junction/child tables
  const sectorPeFirmMap = {};       // `${sectorSlug}:${companySlug}` → uuid
  const sectorTargetCoMap = {};     // `${sectorSlug}:${companySlug}` → uuid
  const searchCovFirmMap = {};      // `${searchSlug}:${companySlug}` → uuid
  const searchCovCoMap = {};        // `${searchSlug}:${companySlug}` → uuid
  const pipelineMap = {};           // `${searchSlug}:${candidateSlug}` → uuid

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1: Sectors & Roster Titles  (from sector_playbooks.json)
    // ══════════════════════════════════════════════════════════════════════
    const playbooks = loadJSON('sector_playbooks.json');

    // 1a. Roster titles
    console.log(`  Inserting ${playbooks.roster_titles.length} roster titles...`);
    let inserted = 0, skipped = 0;
    for (let i = 0; i < playbooks.roster_titles.length; i++) {
      const title = playbooks.roster_titles[i];
      try {
        const res = await pool.query(
          `INSERT INTO roster_titles (title, sort_order)
           VALUES ($1, $2)
           ON CONFLICT (title) DO NOTHING
           RETURNING id`,
          [title, i]
        );
        if (res.rows.length > 0) inserted++; else skipped++;
      } catch (err) {
        console.error(`  ❌ roster_title "${title}":`, err.message);
        totalErrors++;
      }
    }
    console.log(`  ✓ roster_titles: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 1b. Sectors
    console.log(`  Inserting ${playbooks.sectors.length} sectors...`);
    inserted = 0; skipped = 0;
    for (const sector of playbooks.sectors) {
      try {
        const res = await pool.query(
          `INSERT INTO sectors (slug, sector_name, build_status, last_updated)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (slug) DO NOTHING
           RETURNING id`,
          [sector.sector_id, sector.sector_name, sector.build_status || 'partial', toTS(sector.last_updated)]
        );
        if (res.rows.length > 0) {
          sectorMap[sector.sector_id] = res.rows[0].id;
          inserted++;
        } else {
          // Already exists — fetch the UUID
          const existing = await pool.query('SELECT id FROM sectors WHERE slug = $1', [sector.sector_id]);
          if (existing.rows.length > 0) sectorMap[sector.sector_id] = existing.rows[0].id;
          skipped++;
        }
      } catch (err) {
        console.error(`  ❌ sector "${sector.sector_id}":`, err.message);
        totalErrors++;
      }
    }
    console.log(`  ✓ sectors: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 2: Companies  (from company_pool.json)
    // ══════════════════════════════════════════════════════════════════════
    const companyPool = loadJSON('company_pool.json');
    const companies = companyPool.companies || [];
    console.log(`  Inserting ${companies.length} companies...`);
    inserted = 0; skipped = 0;

    for (const c of companies) {
      try {
        const res = await pool.query(
          `INSERT INTO companies (
            slug, company_type, name, hq, website_url, linkedin_company_url, description,
            year_founded, notes, source, enrichment_status,
            industry, industry_sector, gecs_sector, gecs_industry_group, gecs_industry,
            pb_industry_sector, pb_industry_group, pb_industry_code,
            employee_count, revenue_tier, revenue_millions, ownership_type, ticker,
            parent_company, pe_sponsors, competitors, employee_history, keywords, verticals,
            size_tier, strategy, entity_type, ownership_status, investment_professionals,
            last_fund_name, last_fund_size, last_fund_vintage, dry_powder,
            preferred_ebitda_min, preferred_ebitda_max, preferred_geography,
            last_investment_date, investments_last_2yr, active_portfolio_count,
            date_added, last_updated
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
            $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,
            $36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47
          )
          ON CONFLICT (slug) DO NOTHING
          RETURNING id`,
          [
            c.company_id, c.company_type || null, c.name,
            c.hq || null, c.website_url || null, c.linkedin_company_url || null,
            c.description || null, c.year_founded || null, c.notes || '',
            c.source || null, c.enrichment_status || null,
            c.industry || null, c.industry_sector || null,
            c.gecs_sector || null, c.gecs_industry_group || null, c.gecs_industry || null,
            c.pb_industry_sector || null, c.pb_industry_group || null, c.pb_industry_code || null,
            c.employee_count || null, c.revenue_tier || null, c.revenue_millions || null,
            c.ownership_type || null, c.ticker || null, c.parent_company || null,
            c.pe_sponsors || null, c.competitors || null, c.employee_history || null,
            c.keywords || null, c.verticals || null,
            c.size_tier || null, c.strategy || null, c.entity_type || null,
            c.ownership_status || null, c.investment_professionals || null,
            c.last_fund_name || null, c.last_fund_size || null, c.last_fund_vintage || null,
            c.dry_powder || null, c.preferred_ebitda_min || null, c.preferred_ebitda_max || null,
            c.preferred_geography || null, toTS(c.last_investment_date),
            c.investments_last_2yr || null, c.active_portfolio_count || null,
            toTS(c.date_added), toTS(c.last_updated)
          ]
        );
        if (res.rows.length > 0) {
          companyMap[c.company_id] = res.rows[0].id;
          inserted++;
        } else {
          const existing = await pool.query('SELECT id FROM companies WHERE slug = $1', [c.company_id]);
          if (existing.rows.length > 0) companyMap[c.company_id] = existing.rows[0].id;
          skipped++;
        }
      } catch (err) {
        console.error(`  ❌ company "${c.company_id}":`, err.message);
        totalErrors++;
      }
    }
    console.log(`  ✓ companies: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 2b. Company aliases
    console.log('  Inserting company aliases...');
    inserted = 0; skipped = 0;
    for (const c of companies) {
      const aliases = c.aliases || [];
      const compUuid = companyMap[c.company_id];
      if (!compUuid || aliases.length === 0) continue;
      for (const alias of aliases) {
        try {
          const res = await pool.query(
            `INSERT INTO company_aliases (company_id, alias)
             VALUES ($1, $2)
             ON CONFLICT (company_id, alias) DO NOTHING
             RETURNING id`,
            [compUuid, alias]
          );
          if (res.rows.length > 0) inserted++; else skipped++;
        } catch (err) {
          console.error(`  ❌ alias "${alias}" for "${c.company_id}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ company_aliases: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 2c. Company sector tags
    console.log('  Inserting company sector tags...');
    inserted = 0; skipped = 0;
    for (const c of companies) {
      const tags = c.sector_focus_tags || [];
      const compUuid = companyMap[c.company_id];
      if (!compUuid || tags.length === 0) continue;
      for (const sectorSlug of tags) {
        const sectorUuid = sectorMap[sectorSlug];
        if (!sectorUuid) continue; // sector not found
        try {
          const res = await pool.query(
            `INSERT INTO company_sector_tags (company_id, sector_id)
             VALUES ($1, $2)
             ON CONFLICT (company_id, sector_id) DO NOTHING
             RETURNING id`,
            [compUuid, sectorUuid]
          );
          if (res.rows.length > 0) inserted++; else skipped++;
        } catch (err) {
          console.error(`  ❌ sector tag "${sectorSlug}" for "${c.company_id}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ company_sector_tags: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 3: Candidates  (from candidate_pool.json)
    // ══════════════════════════════════════════════════════════════════════
    const candidatePool = loadJSON('candidate_pool.json');
    const candidates = candidatePool.candidates || [];
    console.log(`  Inserting ${candidates.length} candidates...`);
    inserted = 0; skipped = 0;

    for (const c of candidates) {
      try {
        const res = await pool.query(
          `INSERT INTO candidates (
            slug, name, current_title, current_firm, home_location, linkedin_url,
            archetype, operator_background, firm_size_tier, company_revenue_tier,
            quality_rating, rating_set_by, rating_date,
            availability, availability_updated, last_contact_date,
            notes, date_added, added_from_search, owned_pl,
            dq_reasons, primary_experience_index, last_scraped
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
          )
          ON CONFLICT (slug) DO NOTHING
          RETURNING id`,
          [
            c.candidate_id, c.name, c.current_title || null, c.current_firm || null,
            c.home_location || null, c.linkedin_url || null, c.archetype || null,
            toTextArray(c.operator_background),
            c.firm_size_tier || null, c.company_revenue_tier || null,
            c.quality_rating || null, c.rating_set_by || null, toTS(c.rating_date),
            c.availability || 'Unknown', toTS(c.availability_updated),
            toTS(c.last_contact_date), c.notes || '', toTS(c.date_added),
            c.added_from_search || '', c.owned_pl || false,
            toTextArray(c.dq_reasons),
            c.primary_experience_index != null ? c.primary_experience_index : null,
            toTS(c.last_scraped)
          ]
        );
        if (res.rows.length > 0) {
          candidateMap[c.candidate_id] = res.rows[0].id;
          inserted++;
        } else {
          const existing = await pool.query('SELECT id FROM candidates WHERE slug = $1', [c.candidate_id]);
          if (existing.rows.length > 0) candidateMap[c.candidate_id] = existing.rows[0].id;
          skipped++;
        }
      } catch (err) {
        console.error(`  ❌ candidate "${c.candidate_id}":`, err.message);
        totalErrors++;
      }
    }
    console.log(`  ✓ candidates: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 3b. Candidate sector tags
    console.log('  Inserting candidate sector tags...');
    inserted = 0; skipped = 0;
    for (const c of candidates) {
      const tags = c.sector_tags || [];
      const candUuid = candidateMap[c.candidate_id];
      if (!candUuid || tags.length === 0) continue;
      for (const sectorSlug of tags) {
        const sectorUuid = sectorMap[sectorSlug];
        if (!sectorUuid) continue;
        try {
          const res = await pool.query(
            `INSERT INTO candidate_sector_tags (candidate_id, sector_id)
             VALUES ($1, $2)
             ON CONFLICT (candidate_id, sector_id) DO NOTHING
             RETURNING id`,
            [candUuid, sectorUuid]
          );
          if (res.rows.length > 0) inserted++; else skipped++;
        } catch (err) {
          console.error(`  ❌ candidate sector tag "${sectorSlug}" for "${c.candidate_id}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ candidate_sector_tags: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 3c. Candidate work history
    console.log('  Inserting candidate work history...');
    inserted = 0; skipped = 0;
    for (const c of candidates) {
      const history = c.work_history || [];
      const candUuid = candidateMap[c.candidate_id];
      if (!candUuid || history.length === 0) continue;
      await pool.query('DELETE FROM candidate_work_history WHERE candidate_id = $1', [candUuid]);
      for (let i = 0; i < history.length; i++) {
        const w = history[i];
        const compUuid = w.company_id ? companyMap[w.company_id] || null : null;
        const isPrimary = c.primary_experience_index === i;
        try {
          await pool.query(
            `INSERT INTO candidate_work_history (
              candidate_id, company_id, title, company_name, dates, date_range,
              duration, description, sort_order, is_primary
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              candUuid, compUuid, w.title || null, w.company || null,
              w.dates || null, w.dateRange || null, w.duration || null,
              w.description || null, i, isPrimary
            ]
          );
          inserted++;
        } catch (err) {
          console.error(`  ❌ work_history[${i}] for "${c.candidate_id}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ candidate_work_history: ${inserted} inserted`);
    totalInserted += inserted;

    // 3d. Candidate search history
    console.log('  Inserting candidate search history...');
    inserted = 0; skipped = 0;
    for (const c of candidates) {
      const history = c.search_history || [];
      const candUuid = candidateMap[c.candidate_id];
      if (!candUuid || history.length === 0) continue;
      for (const searchSlug of history) {
        const searchUuid = searchMap[searchSlug];
        if (!searchUuid) continue; // search not yet loaded — will be handled after searches phase
      }
    }
    // Note: search_history links are populated after searches are loaded (Phase 4d)

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 4: Searches  (from active_searches.json)
    // ══════════════════════════════════════════════════════════════════════
    const searchData = loadJSON('active_searches.json');
    const searches = searchData.searches || [];
    console.log(`  Inserting ${searches.length} searches...`);
    inserted = 0; skipped = 0;

    for (const s of searches) {
      try {
        const res = await pool.query(
          `INSERT INTO searches (
            slug, client_name, role_title, status, lead_recruiter,
            ideal_candidate_profile, archetypes_requested,
            date_opened, date_closed
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (slug) DO NOTHING
          RETURNING id`,
          [
            s.search_id, s.client_name, s.role_title || null,
            s.status || 'active', s.lead_recruiter || null,
            s.ideal_candidate_profile || '', toTextArray(s.archetypes_requested),
            toTS(s.date_opened), toTS(s.date_closed)
          ]
        );
        if (res.rows.length > 0) {
          searchMap[s.search_id] = res.rows[0].id;
          inserted++;
        } else {
          const existing = await pool.query('SELECT id FROM searches WHERE slug = $1', [s.search_id]);
          if (existing.rows.length > 0) searchMap[s.search_id] = existing.rows[0].id;
          skipped++;
        }
      } catch (err) {
        console.error(`  ❌ search "${s.search_id}":`, err.message);
        totalErrors++;
      }
    }
    console.log(`  ✓ searches: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 4b. Search sectors
    console.log('  Inserting search sectors...');
    inserted = 0; skipped = 0;
    for (const s of searches) {
      const searchUuid = searchMap[s.search_id];
      if (!searchUuid) continue;
      for (const sectorSlug of (s.sectors || [])) {
        const sectorUuid = sectorMap[sectorSlug];
        if (!sectorUuid) continue;
        try {
          const res = await pool.query(
            `INSERT INTO search_sectors (search_id, sector_id)
             VALUES ($1, $2)
             ON CONFLICT (search_id, sector_id) DO NOTHING
             RETURNING id`,
            [searchUuid, sectorUuid]
          );
          if (res.rows.length > 0) inserted++; else skipped++;
        } catch (err) {
          console.error(`  ❌ search_sector "${s.search_id}" → "${sectorSlug}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ search_sectors: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 4c. Search client contacts & lancor team
    console.log('  Inserting search client contacts & lancor team...');
    let contactsInserted = 0, teamInserted = 0;
    for (const s of searches) {
      const searchUuid = searchMap[s.search_id];
      if (!searchUuid) continue;

      await pool.query('DELETE FROM search_client_contacts WHERE search_id = $1', [searchUuid]);
      await pool.query('DELETE FROM search_lancor_team WHERE search_id = $1', [searchUuid]);

      for (let i = 0; i < (s.client_contacts || []).length; i++) {
        const cc = s.client_contacts[i];
        try {
          await pool.query(
            `INSERT INTO search_client_contacts (search_id, name, abbreviation, display_in_matrix, sort_order)
             VALUES ($1,$2,$3,$4,$5)`,
            [searchUuid, cc.name, cc.abbreviation || null, cc.display_in_matrix !== false, i]
          );
          contactsInserted++;
        } catch (err) {
          console.error(`  ❌ client_contact "${cc.name}" on "${s.search_id}":`, err.message);
          totalErrors++;
        }
      }

      for (let i = 0; i < (s.lancor_team || []).length; i++) {
        const tm = s.lancor_team[i];
        try {
          await pool.query(
            `INSERT INTO search_lancor_team (search_id, initials, full_name, role, sort_order)
             VALUES ($1,$2,$3,$4,$5)`,
            [searchUuid, tm.initials, tm.full_name, tm.role || null, i]
          );
          teamInserted++;
        } catch (err) {
          console.error(`  ❌ lancor_team "${tm.initials}" on "${s.search_id}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ search_client_contacts: ${contactsInserted} inserted`);
    console.log(`  ✓ search_lancor_team: ${teamInserted} inserted`);
    totalInserted += contactsInserted + teamInserted;

    // 4d. Candidate search history (now that searchMap is populated)
    console.log('  Inserting candidate search history...');
    inserted = 0; skipped = 0;
    for (const c of candidates) {
      const history = c.search_history || [];
      const candUuid = candidateMap[c.candidate_id];
      if (!candUuid || history.length === 0) continue;
      for (const searchSlug of history) {
        const searchUuid = searchMap[searchSlug];
        if (!searchUuid) continue;
        try {
          const res = await pool.query(
            `INSERT INTO candidate_search_history (candidate_id, search_id)
             VALUES ($1, $2)
             ON CONFLICT (candidate_id, search_id) DO NOTHING
             RETURNING id`,
            [candUuid, searchUuid]
          );
          if (res.rows.length > 0) inserted++; else skipped++;
        } catch (err) {
          console.error(`  ❌ candidate_search_history "${c.candidate_id}" → "${searchSlug}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ candidate_search_history: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 5: Search Pipeline
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n📂 Processing search pipelines...');
    inserted = 0; skipped = 0;

    for (const s of searches) {
      const searchUuid = searchMap[s.search_id];
      if (!searchUuid) continue;
      const pipeline = s.pipeline || [];

      for (const p of pipeline) {
        // Ensure candidate exists in candidate pool — pipeline candidates may not be there yet
        let candUuid = candidateMap[p.candidate_id];
        if (!candUuid) {
          // Create a minimal candidate record
          try {
            const res = await pool.query(
              `INSERT INTO candidates (slug, name, current_title, current_firm, home_location, linkedin_url, archetype, date_added)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (slug) DO NOTHING
               RETURNING id`,
              [p.candidate_id, p.name, p.current_title || null, p.current_firm || null,
               p.location || null, p.linkedin_url || null, p.archetype || null, toTS(p.date_added)]
            );
            if (res.rows.length > 0) {
              candUuid = res.rows[0].id;
              candidateMap[p.candidate_id] = candUuid;
            } else {
              const existing = await pool.query('SELECT id FROM candidates WHERE slug = $1', [p.candidate_id]);
              if (existing.rows.length > 0) {
                candUuid = existing.rows[0].id;
                candidateMap[p.candidate_id] = candUuid;
              }
            }
          } catch (err) {
            console.error(`  ❌ auto-create candidate "${p.candidate_id}":`, err.message);
            totalErrors++;
            continue;
          }
        }
        if (!candUuid) continue;

        try {
          const res = await pool.query(
            `INSERT INTO search_pipeline (
              search_id, candidate_id, name, current_title, current_firm, location,
              linkedin_url, archetype, source, stage, lancor_screener, screen_date,
              lancor_assessment, resume_attached, client_feedback,
              next_step, next_step_owner, next_step_date,
              dq_reason, last_touchpoint, notes, date_added
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            ON CONFLICT (search_id, candidate_id) DO NOTHING
            RETURNING id`,
            [
              searchUuid, candUuid, p.name, p.current_title || null, p.current_firm || null,
              p.location || null, p.linkedin_url || null, p.archetype || null,
              p.source || null, p.stage || 'Pursuing', p.lancor_screener || '',
              toTS(p.screen_date), p.lancor_assessment || '',
              p.resume_attached || false, p.client_feedback || '',
              p.next_step || '', p.next_step_owner || '', toTS(p.next_step_date),
              p.dq_reason || '', toTS(p.last_touchpoint), p.notes || '', toTS(p.date_added)
            ]
          );
          let pipelineUuid;
          if (res.rows.length > 0) {
            pipelineUuid = res.rows[0].id;
            inserted++;
          } else {
            const existing = await pool.query(
              'SELECT id FROM search_pipeline WHERE search_id = $1 AND candidate_id = $2',
              [searchUuid, candUuid]
            );
            if (existing.rows.length > 0) pipelineUuid = existing.rows[0].id;
            skipped++;
          }

          if (pipelineUuid) {
            pipelineMap[`${s.search_id}:${p.candidate_id}`] = pipelineUuid;

            // Delete existing meetings then re-insert
            await pool.query('DELETE FROM pipeline_client_meetings WHERE pipeline_entry_id = $1', [pipelineUuid]);
            const meetings = p.client_meetings || [];
            for (let mi = 0; mi < meetings.length; mi++) {
              const m = meetings[mi];
              try {
                await pool.query(
                  `INSERT INTO pipeline_client_meetings (pipeline_entry_id, contact_name, status, meeting_date, sort_order)
                   VALUES ($1,$2,$3,$4,$5)`,
                  [pipelineUuid, m.contact_name, m.status || '—', toTS(m.date), mi]
                );
              } catch (merr) {
                console.error(`  ❌ meeting "${m.contact_name}" on pipeline "${p.candidate_id}":`, merr.message);
                totalErrors++;
              }
            }
          }
        } catch (err) {
          console.error(`  ❌ pipeline "${p.candidate_id}" on "${s.search_id}":`, err.message);
          totalErrors++;
        }
      }
    }
    console.log(`  ✓ search_pipeline: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 6: Sector Playbooks — PE Firms & Target Companies + Rosters
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n📂 Processing sector playbooks...');

    for (const sector of playbooks.sectors) {
      const sectorUuid = sectorMap[sector.sector_id];
      if (!sectorUuid) continue;

      // 6a. PE Firms
      const peFirms = sector.pe_firms || [];
      inserted = 0; skipped = 0;
      let rosterInserted = 0;

      for (const firm of peFirms) {
        // Ensure the firm exists in companies table
        let firmCompanyUuid = companyMap[firm.firm_id];
        if (!firmCompanyUuid) {
          // Create a minimal company record for this PE firm
          try {
            const res = await pool.query(
              `INSERT INTO companies (slug, company_type, name, hq, size_tier, strategy)
               VALUES ($1, 'PE Firm', $2, $3, $4, $5)
               ON CONFLICT (slug) DO NOTHING
               RETURNING id`,
              [firm.firm_id, firm.name, firm.hq || null, firm.size_tier || null, firm.strategy || null]
            );
            if (res.rows.length > 0) {
              firmCompanyUuid = res.rows[0].id;
              companyMap[firm.firm_id] = firmCompanyUuid;
            } else {
              const existing = await pool.query('SELECT id FROM companies WHERE slug = $1', [firm.firm_id]);
              if (existing.rows.length > 0) {
                firmCompanyUuid = existing.rows[0].id;
                companyMap[firm.firm_id] = firmCompanyUuid;
              }
            }
          } catch (err) {
            console.error(`  ❌ auto-create company "${firm.firm_id}":`, err.message);
            totalErrors++;
            continue;
          }
        }
        if (!firmCompanyUuid) continue;

        try {
          const res = await pool.query(
            `INSERT INTO sector_pe_firms (
              sector_id, company_id, name, hq, size_tier, strategy, sector_focus,
              why_target, expected_roster_size, custom_roster_size,
              roster_completeness, manual_complete_note, last_roster_audit
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (sector_id, company_id) DO NOTHING
            RETURNING id`,
            [
              sectorUuid, firmCompanyUuid, firm.name, firm.hq || null,
              firm.size_tier || null, firm.strategy || null, firm.sector_focus || null,
              firm.why_target || '', firm.expected_roster_size || null,
              firm.custom_roster_size || null, firm.roster_completeness || 'auto',
              firm.manual_complete_note || null, toTS(firm.last_roster_audit)
            ]
          );

          let spfUuid;
          if (res.rows.length > 0) {
            spfUuid = res.rows[0].id;
            inserted++;
          } else {
            const existing = await pool.query(
              'SELECT id FROM sector_pe_firms WHERE sector_id = $1 AND company_id = $2',
              [sectorUuid, firmCompanyUuid]
            );
            if (existing.rows.length > 0) spfUuid = existing.rows[0].id;
            skipped++;
          }

          if (spfUuid) {
            sectorPeFirmMap[`${sector.sector_id}:${firm.firm_id}`] = spfUuid;

            // Delete existing roster then re-insert
            await pool.query('DELETE FROM playbook_firm_roster WHERE sector_pe_firm_id = $1', [spfUuid]);
            for (const person of (firm.roster || [])) {
              const candUuid = person.candidate_id ? candidateMap[person.candidate_id] || null : null;
              try {
                await pool.query(
                  `INSERT INTO playbook_firm_roster (
                    sector_pe_firm_id, candidate_id, candidate_slug,
                    name, title, linkedin_url, roster_status, last_updated
                  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                  [
                    spfUuid, candUuid, person.candidate_id || null,
                    person.name, person.title || null, person.linkedin_url || null,
                    person.roster_status || 'Identified', toTS(person.last_updated)
                  ]
                );
                rosterInserted++;
              } catch (rerr) {
                console.error(`  ❌ firm roster "${person.name}" on "${firm.firm_id}":`, rerr.message);
                totalErrors++;
              }
            }
          }
        } catch (err) {
          console.error(`  ❌ sector_pe_firm "${firm.firm_id}" in "${sector.sector_id}":`, err.message);
          totalErrors++;
        }
      }
      console.log(`  ✓ ${sector.sector_id} PE firms: ${inserted} inserted, ${skipped} skipped, ${rosterInserted} roster`);
      totalInserted += inserted + rosterInserted; totalSkipped += skipped;

      // 6b. Target Companies
      const targetCos = sector.target_companies || [];
      inserted = 0; skipped = 0; rosterInserted = 0;

      for (const co of targetCos) {
        let coCompanyUuid = companyMap[co.company_id];
        if (!coCompanyUuid) {
          try {
            const res = await pool.query(
              `INSERT INTO companies (slug, company_type, name, hq, revenue_tier, ownership_type)
               VALUES ($1, 'Portfolio Company', $2, $3, $4, $5)
               ON CONFLICT (slug) DO NOTHING
               RETURNING id`,
              [co.company_id, co.name, co.hq || null, co.revenue_tier || null, co.ownership_type || null]
            );
            if (res.rows.length > 0) {
              coCompanyUuid = res.rows[0].id;
              companyMap[co.company_id] = coCompanyUuid;
            } else {
              const existing = await pool.query('SELECT id FROM companies WHERE slug = $1', [co.company_id]);
              if (existing.rows.length > 0) {
                coCompanyUuid = existing.rows[0].id;
                companyMap[co.company_id] = coCompanyUuid;
              }
            }
          } catch (err) {
            console.error(`  ❌ auto-create company "${co.company_id}":`, err.message);
            totalErrors++;
            continue;
          }
        }
        if (!coCompanyUuid) continue;

        try {
          const rolesToTarget = Array.isArray(co.roles_to_target)
            ? co.roles_to_target.join(', ')
            : (co.roles_to_target || '');

          const res = await pool.query(
            `INSERT INTO sector_target_companies (
              sector_id, company_id, name, hq, revenue_tier, ownership_type,
              industry, employee_count, pe_sponsors, roles_to_target,
              why_target, expected_roster_size, custom_roster_size,
              roster_completeness, manual_complete_note, last_roster_audit
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (sector_id, company_id) DO NOTHING
            RETURNING id`,
            [
              sectorUuid, coCompanyUuid, co.name, co.hq || null,
              co.revenue_tier || null, co.ownership_type || null,
              co.industry || null, co.employee_count || null, co.pe_sponsors || null,
              rolesToTarget, co.why_target || '',
              co.expected_roster_size || null, co.custom_roster_size || null,
              co.roster_completeness || 'auto', co.manual_complete_note || null,
              toTS(co.last_roster_audit)
            ]
          );

          let stcUuid;
          if (res.rows.length > 0) {
            stcUuid = res.rows[0].id;
            inserted++;
          } else {
            const existing = await pool.query(
              'SELECT id FROM sector_target_companies WHERE sector_id = $1 AND company_id = $2',
              [sectorUuid, coCompanyUuid]
            );
            if (existing.rows.length > 0) stcUuid = existing.rows[0].id;
            skipped++;
          }

          if (stcUuid) {
            sectorTargetCoMap[`${sector.sector_id}:${co.company_id}`] = stcUuid;

            // Delete existing roster then re-insert
            await pool.query('DELETE FROM playbook_company_roster WHERE sector_target_company_id = $1', [stcUuid]);
            for (const person of (co.roster || [])) {
              const candUuid = person.candidate_id ? candidateMap[person.candidate_id] || null : null;
              try {
                await pool.query(
                  `INSERT INTO playbook_company_roster (
                    sector_target_company_id, candidate_id, candidate_slug,
                    name, title, linkedin_url, roster_status, last_updated
                  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                  [
                    stcUuid, candUuid, person.candidate_id || null,
                    person.name, person.title || null, person.linkedin_url || null,
                    person.roster_status || 'Identified', toTS(person.last_updated)
                  ]
                );
                rosterInserted++;
              } catch (rerr) {
                console.error(`  ❌ company roster "${person.name}" on "${co.company_id}":`, rerr.message);
                totalErrors++;
              }
            }
          }
        } catch (err) {
          console.error(`  ❌ sector_target_company "${co.company_id}" in "${sector.sector_id}":`, err.message);
          totalErrors++;
        }
      }
      console.log(`  ✓ ${sector.sector_id} target companies: ${inserted} inserted, ${skipped} skipped, ${rosterInserted} roster`);
      totalInserted += inserted + rosterInserted; totalSkipped += skipped;

      // 6c. Top companies
      const topCos = sector.top_companies || [];
      inserted = 0;
      for (let i = 0; i < topCos.length; i++) {
        const coSlug = topCos[i];
        const coUuid = companyMap[coSlug];
        if (!coUuid) continue;
        try {
          const res = await pool.query(
            `INSERT INTO sector_top_companies (sector_id, company_id, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (sector_id, company_id) DO NOTHING
             RETURNING id`,
            [sectorUuid, coUuid, i]
          );
          if (res.rows.length > 0) inserted++;
        } catch (err) {
          console.error(`  ❌ top_company "${coSlug}" in "${sector.sector_id}":`, err.message);
          totalErrors++;
        }
      }
      if (topCos.length > 0) {
        console.log(`  ✓ ${sector.sector_id} top companies: ${inserted} inserted`);
        totalInserted += inserted;
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 7: Sourcing Coverage  (from active_searches.json)
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n📂 Processing sourcing coverage...');

    for (const s of searches) {
      const searchUuid = searchMap[s.search_id];
      if (!searchUuid) continue;
      const coverage = s.sourcing_coverage || {};

      // 7a. Coverage PE firms
      const covFirms = coverage.pe_firms || [];
      inserted = 0; skipped = 0;
      let covRosterInserted = 0;

      for (const firm of covFirms) {
        const firmSlug = firm.firm_id;
        let firmCompanyUuid = companyMap[firmSlug];
        if (!firmCompanyUuid) {
          try {
            const res = await pool.query(
              `INSERT INTO companies (slug, company_type, name, hq, size_tier, strategy)
               VALUES ($1, 'PE Firm', $2, $3, $4, $5)
               ON CONFLICT (slug) DO NOTHING
               RETURNING id`,
              [firmSlug, firm.name, firm.hq || null, firm.size_tier || null, firm.strategy || null]
            );
            if (res.rows.length > 0) {
              firmCompanyUuid = res.rows[0].id;
            } else {
              const existing = await pool.query('SELECT id FROM companies WHERE slug = $1', [firmSlug]);
              if (existing.rows.length > 0) firmCompanyUuid = existing.rows[0].id;
            }
            if (firmCompanyUuid) companyMap[firmSlug] = firmCompanyUuid;
          } catch (err) {
            console.error(`  ❌ auto-create cov company "${firmSlug}":`, err.message);
            totalErrors++;
            continue;
          }
        }
        if (!firmCompanyUuid) continue;

        try {
          const res = await pool.query(
            `INSERT INTO search_coverage_firms (
              search_id, company_id, name, hq, size_tier, strategy, sector_focus,
              why_target, manual_complete, manual_complete_note,
              last_verified, verified_by, archived_complete
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (search_id, company_id) DO NOTHING
            RETURNING id`,
            [
              searchUuid, firmCompanyUuid, firm.name, firm.hq || null,
              firm.size_tier || null, firm.strategy || null, firm.sector_focus || null,
              firm.why_target || '', firm.manual_complete || false,
              firm.manual_complete_note || '', toTS(firm.last_verified),
              firm.verified_by || null, firm.archived_complete || false
            ]
          );

          let covFirmUuid;
          if (res.rows.length > 0) {
            covFirmUuid = res.rows[0].id;
            inserted++;
          } else {
            const existing = await pool.query(
              'SELECT id FROM search_coverage_firms WHERE search_id = $1 AND company_id = $2',
              [searchUuid, firmCompanyUuid]
            );
            if (existing.rows.length > 0) covFirmUuid = existing.rows[0].id;
            skipped++;
          }

          if (covFirmUuid) {
            searchCovFirmMap[`${s.search_id}:${firmSlug}`] = covFirmUuid;

            // Delete existing roster then re-insert
            await pool.query('DELETE FROM coverage_firm_roster WHERE coverage_firm_id = $1', [covFirmUuid]);
            for (const person of (firm.roster || [])) {
              const candUuid = person.candidate_id ? candidateMap[person.candidate_id] || null : null;
              try {
                await pool.query(
                  `INSERT INTO coverage_firm_roster (
                    coverage_firm_id, candidate_id, candidate_slug,
                    name, title, linkedin_url, location,
                    roster_status, source, reviewed, reviewed_date, review_status
                  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                  [
                    covFirmUuid, candUuid, person.candidate_id || null,
                    person.name, person.title || null, person.linkedin_url || null,
                    person.location || null, person.roster_status || 'Identified',
                    person.source || null, person.reviewed || false,
                    toTS(person.reviewed_date), person.review_status || null
                  ]
                );
                covRosterInserted++;
              } catch (rerr) {
                console.error(`  ❌ cov firm roster "${person.name}" on "${firmSlug}":`, rerr.message);
                totalErrors++;
              }
            }
          }
        } catch (err) {
          console.error(`  ❌ coverage_firm "${firmSlug}" on "${s.search_id}":`, err.message);
          totalErrors++;
        }
      }
      console.log(`  ✓ ${s.search_id} coverage firms: ${inserted} inserted, ${skipped} skipped, ${covRosterInserted} roster`);
      totalInserted += inserted + covRosterInserted; totalSkipped += skipped;

      // 7b. Coverage Companies
      const covCos = coverage.companies || [];
      inserted = 0; skipped = 0; covRosterInserted = 0;

      for (const co of covCos) {
        const coSlug = co.company_id;
        let coCompanyUuid = companyMap[coSlug];
        if (!coCompanyUuid) {
          try {
            const res = await pool.query(
              `INSERT INTO companies (slug, company_type, name, hq, revenue_tier, ownership_type)
               VALUES ($1, 'Portfolio Company', $2, $3, $4, $5)
               ON CONFLICT (slug) DO NOTHING
               RETURNING id`,
              [coSlug, co.name, co.hq || null, co.revenue_tier || null, co.ownership_type || null]
            );
            if (res.rows.length > 0) {
              coCompanyUuid = res.rows[0].id;
            } else {
              const existing = await pool.query('SELECT id FROM companies WHERE slug = $1', [coSlug]);
              if (existing.rows.length > 0) coCompanyUuid = existing.rows[0].id;
            }
            if (coCompanyUuid) companyMap[coSlug] = coCompanyUuid;
          } catch (err) {
            console.error(`  ❌ auto-create cov company "${coSlug}":`, err.message);
            totalErrors++;
            continue;
          }
        }
        if (!coCompanyUuid) continue;

        try {
          const res = await pool.query(
            `INSERT INTO search_coverage_companies (
              search_id, company_id, name, hq, revenue_tier, ownership_type,
              why_target, manual_complete, manual_complete_note,
              last_verified, verified_by, archived_complete
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (search_id, company_id) DO NOTHING
            RETURNING id`,
            [
              searchUuid, coCompanyUuid, co.name, co.hq || null,
              co.revenue_tier || null, co.ownership_type || null,
              co.why_target || '', co.manual_complete || false,
              co.manual_complete_note || '', toTS(co.last_verified),
              co.verified_by || null, co.archived_complete || false
            ]
          );

          let covCoUuid;
          if (res.rows.length > 0) {
            covCoUuid = res.rows[0].id;
            inserted++;
          } else {
            const existing = await pool.query(
              'SELECT id FROM search_coverage_companies WHERE search_id = $1 AND company_id = $2',
              [searchUuid, coCompanyUuid]
            );
            if (existing.rows.length > 0) covCoUuid = existing.rows[0].id;
            skipped++;
          }

          if (covCoUuid) {
            searchCovCoMap[`${s.search_id}:${coSlug}`] = covCoUuid;

            // Delete existing roster then re-insert
            await pool.query('DELETE FROM coverage_company_roster WHERE coverage_company_id = $1', [covCoUuid]);
            for (const person of (co.roster || [])) {
              const candUuid = person.candidate_id ? candidateMap[person.candidate_id] || null : null;
              try {
                await pool.query(
                  `INSERT INTO coverage_company_roster (
                    coverage_company_id, candidate_id, candidate_slug,
                    name, title, linkedin_url, location,
                    roster_status, source, reviewed, reviewed_date, review_status
                  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                  [
                    covCoUuid, candUuid, person.candidate_id || null,
                    person.name, person.title || null, person.linkedin_url || null,
                    person.location || null, person.roster_status || 'Identified',
                    person.source || null, person.reviewed || false,
                    toTS(person.reviewed_date), person.review_status || null
                  ]
                );
                covRosterInserted++;
              } catch (rerr) {
                console.error(`  ❌ cov company roster "${person.name}" on "${coSlug}":`, rerr.message);
                totalErrors++;
              }
            }
          }
        } catch (err) {
          console.error(`  ❌ coverage_company "${coSlug}" on "${s.search_id}":`, err.message);
          totalErrors++;
        }
      }
      console.log(`  ✓ ${s.search_id} coverage companies: ${inserted} inserted, ${skipped} skipped, ${covRosterInserted} roster`);
      totalInserted += inserted + covRosterInserted; totalSkipped += skipped;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 8: Templates  (from search_templates.json)
    // ══════════════════════════════════════════════════════════════════════
    const templateData = loadJSON('search_templates.json');
    const templates = templateData.templates || {};

    // 8a. Outreach messages
    const outreach = templates.outreach_messages || [];
    console.log(`  Inserting ${outreach.length} outreach messages...`);
    inserted = 0; skipped = 0;
    for (const msg of outreach) {
      try {
        const res = await pool.query(
          `INSERT INTO outreach_messages (slug, name, archetype, channel, subject, body, notes, created_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (slug) DO NOTHING
           RETURNING id`,
          [msg.id, msg.name, msg.archetype || null, msg.channel || null,
           msg.subject || '', msg.body || '', msg.notes || '', toTS(msg.created_date)]
        );
        if (res.rows.length > 0) inserted++; else skipped++;
      } catch (err) {
        console.error(`  ❌ outreach_message "${msg.id}":`, err.message);
        totalErrors++;
      }
    }
    console.log(`  ✓ outreach_messages: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // 8b. Other template types (boolean_strings, pitchbook_params, etc.)
    const otherTypes = [
      { key: 'boolean_strings', type: 'boolean_string' },
      { key: 'pitchbook_params', type: 'pitchbook_param' },
      { key: 'ideal_candidate_profiles', type: 'ideal_candidate_profile' },
      { key: 'screen_question_guides', type: 'screen_question_guide' }
    ];
    for (const { key, type } of otherTypes) {
      const items = templates[key] || [];
      if (items.length === 0) continue;
      inserted = 0;
      for (const item of items) {
        const slug = item.id || `${type}-${Date.now()}`;
        try {
          const res = await pool.query(
            `INSERT INTO search_templates (template_type, slug, name, content, notes, created_date)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (slug) DO NOTHING
             RETURNING id`,
            [type, slug, item.name || slug, item.content || item.body || '',
             item.notes || '', toTS(item.created_date)]
          );
          if (res.rows.length > 0) inserted++;
        } catch (err) {
          console.error(`  ❌ search_template "${slug}":`, err.message);
          totalErrors++;
        }
      }
      console.log(`  ✓ ${key}: ${inserted} inserted`);
      totalInserted += inserted;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 9: Enrichment Progress  (from enrichment_progress.json)
    // ══════════════════════════════════════════════════════════════════════
    const enrichment = loadJSON('enrichment_progress.json');

    const processedIds = enrichment.processed_ids || [];
    const failedIds = enrichment.failed_ids || [];
    console.log(`  Inserting ${processedIds.length} processed + ${failedIds.length} failed enrichment records...`);
    inserted = 0; skipped = 0;

    for (const slug of processedIds) {
      const compUuid = companyMap[slug];
      if (!compUuid) continue;
      try {
        const res = await pool.query(
          `INSERT INTO enrichment_progress (company_id, status)
           VALUES ($1, 'processed')
           ON CONFLICT (company_id) DO NOTHING
           RETURNING id`,
          [compUuid]
        );
        if (res.rows.length > 0) inserted++; else skipped++;
      } catch (err) {
        console.error(`  ❌ enrichment_progress processed "${slug}":`, err.message);
        totalErrors++;
      }
    }
    for (const slug of failedIds) {
      const compUuid = companyMap[slug];
      if (!compUuid) continue;
      try {
        const res = await pool.query(
          `INSERT INTO enrichment_progress (company_id, status)
           VALUES ($1, 'failed')
           ON CONFLICT (company_id) DO NOTHING
           RETURNING id`,
          [compUuid]
        );
        if (res.rows.length > 0) inserted++; else skipped++;
      } catch (err) {
        console.error(`  ❌ enrichment_progress failed "${slug}":`, err.message);
        totalErrors++;
      }
    }
    console.log(`  ✓ enrichment_progress: ${inserted} inserted, ${skipped} skipped`);
    totalInserted += inserted; totalSkipped += skipped;

    // ══════════════════════════════════════════════════════════════════════
    // DONE
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n══════════════════════════════════════════════');
    console.log(`  Migration complete`);
    console.log(`  Total inserted: ${totalInserted}`);
    console.log(`  Total skipped:  ${totalSkipped}`);
    console.log(`  Total errors:   ${totalErrors}`);
    console.log('══════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n🔥 Fatal migration error:', err);
  } finally {
    await pool.end();
    console.log('Database connection closed.');
  }
}

migrate();
