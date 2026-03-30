#!/usr/bin/env node
// One-time migration: populate sector_top_pe_firms from data/sector_playbooks.json
// Safe to re-run: uses ON CONFLICT DO NOTHING

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DATA_DIR = path.join(__dirname, '..', 'data');

async function migrate() {
  try {
    const playbooks = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sector_playbooks.json'), 'utf8'));
    let totalInserted = 0;
    let totalSkipped = 0;

    for (const sector of playbooks.sectors) {
      const topFirms = sector.top_pe_firms || [];
      if (topFirms.length === 0) continue;

      // Look up sector UUID
      const { rows: sectorRows } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [sector.sector_id]);
      if (sectorRows.length === 0) {
        console.log(`  ⚠ Sector "${sector.sector_id}" not found, skipping`);
        continue;
      }
      const sectorUuid = sectorRows[0].id;

      let inserted = 0, skipped = 0;
      for (let i = 0; i < topFirms.length; i++) {
        const firmSlug = topFirms[i];
        const { rows: companyRows } = await pool.query('SELECT id FROM companies WHERE slug = $1', [firmSlug]);
        if (companyRows.length === 0) {
          console.log(`  ⚠ Company "${firmSlug}" not found, skipping`);
          continue;
        }
        try {
          const res = await pool.query(
            `INSERT INTO sector_top_pe_firms (sector_id, company_id, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (sector_id, company_id) DO NOTHING
             RETURNING id`,
            [sectorUuid, companyRows[0].id, i]
          );
          if (res.rows.length > 0) inserted++; else skipped++;
        } catch (err) {
          console.error(`  ❌ "${firmSlug}" in "${sector.sector_id}":`, err.message);
        }
      }
      console.log(`  ✓ ${sector.sector_id}: ${inserted} inserted, ${skipped} skipped (of ${topFirms.length})`);
      totalInserted += inserted;
      totalSkipped += skipped;
    }

    console.log(`\nDone. ${totalInserted} inserted, ${totalSkipped} skipped.`);

    // Confirm row counts
    const { rows } = await pool.query(
      `SELECT s.slug AS sector, COUNT(*) AS count
       FROM sector_top_pe_firms stpf
       JOIN sectors s ON s.id = stpf.sector_id
       GROUP BY s.slug ORDER BY s.slug`
    );
    console.log('\nRow counts by sector:');
    let total = 0;
    for (const r of rows) {
      console.log(`  ${r.sector}: ${r.count}`);
      total += parseInt(r.count);
    }
    console.log(`  TOTAL: ${total}`);
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await pool.end();
  }
}

migrate();
