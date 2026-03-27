'use strict';

/**
 * score_top_firms.js
 *
 * Scores all PE firms in each sector playbook and populates the
 * top_pe_firms array with the top 25 firm IDs ranked by a composite
 * score based on sector focus, size tier, entity type, and activity.
 *
 * Usage: node scripts/score_top_firms.js [--dry-run]
 */

const fs   = require('fs');
const path = require('path');

const playbooksPath = path.join(__dirname, '../data/sector_playbooks.json');
const dryRun = process.argv.includes('--dry-run');

// ── Scoring weights ──────────────────────────────────────────────────────────

const SECTOR_FOCUS_SCORE = {
  'Primary':       30,
  'Significant':   20,
  'Opportunistic':  5
};

const SIZE_TIER_SCORE = {
  'Mega':                15,
  'Large':               12,
  'Middle Market':        8,
  'Lower Middle Market':  3
};

const ENTITY_TYPE_SCORE = {
  'Dedicated PE Firm':   5,
  'Growth Equity Firm':  4,
  'Buyout':              4,
  'Multi-Strategy':      3,
  'Impact':              2,
  'Infrastructure':      2
};

function scoreFirm(firm) {
  let score = 0;

  // Sector focus
  score += SECTOR_FOCUS_SCORE[firm.sector_focus] || 0;

  // Size tier
  score += SIZE_TIER_SCORE[firm.size_tier] || 0;

  // Entity type
  score += ENTITY_TYPE_SCORE[firm.entity_type] || 0;

  // Active investing
  if (firm.investments_last_2yr && firm.investments_last_2yr > 0) score += 5;

  // Dry powder
  if (firm.dry_powder && firm.dry_powder > 500) score += 3;

  // Has roster data (we know people there)
  if (firm.roster && firm.roster.length > 0) score += 2;

  // Recent investment activity
  if (firm.last_investment_date) {
    const lastDate = new Date(firm.last_investment_date);
    const monthsAgo = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsAgo < 12) score += 2; // invested in last year
  }

  return score;
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Score Top Firms Script');
console.log(dryRun ? '  [DRY RUN]\n' : '\n');

const data = JSON.parse(fs.readFileSync(playbooksPath, 'utf8'));

data.sectors.forEach(sector => {
  if (!sector.top_pe_firms) sector.top_pe_firms = [];

  const firms = sector.pe_firms || [];

  // Score each firm
  const scored = firms.map(f => ({
    firm_id: f.firm_id,
    name: f.name,
    score: scoreFirm(f),
    size_tier: f.size_tier || '—',
    sector_focus: f.sector_focus || '—'
  }));

  // Sort by score descending, then by name for ties
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Take top 25, preferring non-Lower-Middle-Market
  // First, try to fill 25 slots with MM+ firms
  const mmPlus = scored.filter(f => f.size_tier !== 'Lower Middle Market');
  const top = mmPlus.slice(0, 25);

  // If we don't have 25, fill remaining with LMM
  if (top.length < 25) {
    const lmm = scored.filter(f => f.size_tier === 'Lower Middle Market');
    top.push(...lmm.slice(0, 25 - top.length));
  }

  sector.top_pe_firms = top.map(f => f.firm_id);

  // Print summary
  console.log(`${sector.sector_name}:`);
  console.log(`  Total firms: ${firms.length} | Top 25 selected`);
  top.slice(0, 5).forEach((f, i) =>
    console.log(`    ${i + 1}. ${f.name} (score: ${f.score}, ${f.size_tier}, ${f.sector_focus})`)
  );
  if (top.length > 5) console.log(`    ... and ${top.length - 5} more`);
  console.log('');
});

if (dryRun) {
  console.log('[DRY RUN] No changes written.');
} else {
  fs.writeFileSync(playbooksPath, JSON.stringify(data, null, 2), 'utf8');
  console.log('Done! Top PE firms written to sector_playbooks.json');
}
