'use strict';

/**
 * audit-sector-tags-quality.js
 *
 * Classifies PE firms by sector specialization using Anthropic API.
 * For each PE firm, determines which sectors they invest in and whether
 * they are a specialist in each sector. Updates company_sector_tags
 * with is_specialist flag.
 *
 * Usage:
 *   node scripts/audit-sector-tags-quality.js
 *   node scripts/audit-sector-tags-quality.js --limit 50
 *   node scripts/audit-sector-tags-quality.js --dry-run --limit 5
 *   node scripts/audit-sector-tags-quality.js --offset 100
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../server/db');

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
const limit   = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
const offset  = argVal('--offset') ? parseInt(argVal('--offset'), 10) : 0;
const dryRun  = args.includes('--dry-run');

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1500;
const MODEL = 'claude-sonnet-4-20250514';

// ── Anthropic client ────────────────────────────────────────────────────────

let anthropic = null;
function getClient() {
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ERROR: ANTHROPIC_API_KEY not set in .env');
      process.exit(1);
    }
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Sector lookup ───────────────────────────────────────────────────────────

const VALID_SLUGS = new Set([
  'industrials', 'technology-software', 'tech-enabled-services', 'healthcare',
  'financial-services', 'consumer', 'business-services', 'infrastructure-energy',
  'life-sciences', 'media-entertainment', 'real-estate-proptech', 'agriculture-fb'
]);

let _sectorMap = null;
async function getSectorMap() {
  if (_sectorMap) return _sectorMap;
  const { rows } = await pool.query('SELECT id, slug FROM sectors');
  _sectorMap = {};
  for (const r of rows) _sectorMap[r.slug] = r.id;
  return _sectorMap;
}

// ── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(firm) {
  return `You are an expert in private equity firm strategies. For the given PE firm, identify which sectors they invest in and whether they are a specialist in each sector.

A SPECIALIST firm has:
- A dedicated team or fund focused on that sector
- Multiple portfolio companies in that sector
- Publicly stated sector focus in their strategy
- The sector represents a majority of their AUM or deal flow

A NON-SPECIALIST (generalist) firm invests in a sector opportunistically but it is not their primary focus.

Firm: ${firm.name}
Strategy: ${firm.strategy || 'Unknown'}
Size tier: ${firm.size_tier || 'Unknown'}
Description: ${firm.description || 'Unknown'}

Available sectors: industrials, technology-software, tech-enabled-services, healthcare, financial-services, consumer, business-services, infrastructure-energy, life-sciences, media-entertainment, real-estate-proptech, agriculture-fb

Return ONLY valid JSON array. Examples:
- Welsh Carson Anderson & Stowe → [{"sector":"healthcare","specialist":true}]
- Linden → [{"sector":"healthcare","specialist":true},{"sector":"technology-software","specialist":false},{"sector":"business-services","specialist":false}]
- Berkshire Partners → [{"sector":"industrials","specialist":true},{"sector":"consumer","specialist":false},{"sector":"business-services","specialist":false}]
- KKR → [{"sector":"industrials","specialist":false},{"sector":"technology-software","specialist":false},{"sector":"healthcare","specialist":false},{"sector":"financial-services","specialist":false},{"sector":"consumer","specialist":false},{"sector":"business-services","specialist":false}]
- Stellex Capital Management → [{"sector":"industrials","specialist":true}]
- Shore Capital Partners → [{"sector":"healthcare","specialist":true}]

Only include sectors where they have genuine investment activity. Return empty array [] for unknown firms.`;
}

// ── Parse response ──────────────────────────────────────────────────────────

function parseResponse(response) {
  let text = '';
  for (const block of response.content || []) {
    if (block.type === 'text') text += block.text;
  }

  // Find JSON array in response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    // Validate each entry
    return arr.filter(e =>
      e && typeof e.sector === 'string' && VALID_SLUGS.has(e.sector) &&
      typeof e.specialist === 'boolean'
    );
  } catch {
    return [];
  }
}

// ── Process one firm ────────────────────────────────────────────────────────

async function processFirm(firm, sectorMap) {
  const client = getClient();

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: buildPrompt(firm) }]
    });
  } catch (err) {
    console.error(`  ✗ API error for "${firm.name}": ${err.message}`);
    return { name: firm.name, error: err.message, tags: [] };
  }

  const tags = parseResponse(response);

  if (dryRun) {
    const summary = tags.map(t => `${t.sector}${t.specialist ? ' ★' : ''}`).join(', ') || '(none)';
    console.log(`  [DRY RUN] ${firm.name} → ${summary}`);
    return { name: firm.name, tags };
  }

  // Delete existing tags for this company
  await pool.query('DELETE FROM company_sector_tags WHERE company_id = $1', [firm.id]);

  // Insert new tags
  for (const tag of tags) {
    const sectorId = sectorMap[tag.sector];
    if (!sectorId) continue;
    await pool.query(
      `INSERT INTO company_sector_tags (company_id, sector_id, sector_slug, is_specialist)
       VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, sector_id) DO UPDATE SET is_specialist = $4`,
      [firm.id, sectorId, tag.sector, tag.specialist]
    );
  }

  const summary = tags.map(t => `${t.sector}${t.specialist ? ' ★' : ''}`).join(', ') || '(none)';
  console.log(`  ✓ ${firm.name} → ${summary}`);
  return { name: firm.name, tags };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const sectorMap = await getSectorMap();

  // Count total PE firms
  const { rows: [{ count: totalCount }] } = await pool.query(
    "SELECT COUNT(*) FROM companies WHERE company_type = 'PE Firm'"
  );

  let query = `SELECT id, slug, name, company_type, size_tier, description, strategy
               FROM companies WHERE company_type = 'PE Firm'
               ORDER BY name`;
  const params = [];
  if (limit) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(limit);
  }
  if (offset) {
    query += ` OFFSET $${params.length + 1}`;
    params.push(offset);
  }

  const { rows: firms } = await pool.query(query, params);

  const processing = firms.length;
  const batches = Math.ceil(processing / BATCH_SIZE);
  const estApiTimeSec = processing * 2;
  const estDelayTimeSec = batches * (BATCH_DELAY_MS / 1000);
  const estTotalMin = Math.round((estApiTimeSec + estDelayTimeSec) / 60);
  const estInputTokens = processing * 800;
  const estOutputTokens = processing * 200;
  const estCostInput = (estInputTokens / 1_000_000) * 3;
  const estCostOutput = (estOutputTokens / 1_000_000) * 15;
  const estCost = (estCostInput + estCostOutput).toFixed(2);

  console.log('═══════════════════════════════════════════════════');
  console.log('  Sector Specialist Tagging — PE Firms');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total PE firms in DB:  ${totalCount}`);
  console.log(`  Processing:            ${processing} firms`);
  console.log(`  Batches:               ${batches} (size ${BATCH_SIZE})`);
  console.log(`  Estimated run time:    ~${estTotalMin} minutes`);
  console.log(`  Estimated API cost:    ~$${estCost}`);
  console.log(`  Model:                 ${MODEL}`);
  console.log(`  Dry run:               ${dryRun}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  let processed = 0;
  let errors = 0;
  let specialistCount = 0;

  for (let b = 0; b < batches; b++) {
    const batchStart = b * BATCH_SIZE;
    const batch = firms.slice(batchStart, batchStart + BATCH_SIZE);

    console.log(`Batch ${b + 1}/${batches} (firms ${batchStart + 1}–${batchStart + batch.length}):`);

    for (const firm of batch) {
      const result = await processFirm(firm, sectorMap);
      processed++;
      if (result.error) errors++;
      specialistCount += result.tags.filter(t => t.specialist).length;
    }

    // Delay between batches (skip after last batch)
    if (b < batches - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Done. Processed: ${processed} | Errors: ${errors} | Specialist tags: ${specialistCount}`);
  console.log('═══════════════════════════════════════════════════');

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
