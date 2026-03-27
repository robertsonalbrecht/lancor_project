'use strict';

/**
 * import_pitchbook_companies.js
 *
 * Imports PE-backed portfolio companies from a PitchBook Excel export into:
 * 1. company_pool.json — full company records with GECS industry data
 * 2. sector_playbooks.json — target_companies per sector + top_companies rankings
 *
 * Usage:
 *   node scripts/import_pitchbook_companies.js [--dry-run]
 *
 * Source: PE_backed_300_employee.xlsx (PitchBook export)
 */

const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { slugify, normCompanyName } = require('../server/utils/shared');

const excelPath      = path.join(__dirname, '..', 'PE_backed_300_employee.xlsx');
const companyPoolPath = path.join(__dirname, '..', 'data', 'company_pool.json');
const playbooksPath   = path.join(__dirname, '..', 'data', 'sector_playbooks.json');

const dryRun = process.argv.includes('--dry-run');
const today  = new Date().toISOString().slice(0, 10);

// ── GECS Sector → Our Sector ID mapping ──────────────────────────────────────

const GECS_SECTOR_MAP = {
  'Industrials':            ['industrials'],
  'Technology':             ['technology-software', 'tech-enabled-services'],
  'Healthcare':             ['healthcare', 'life-sciences'],
  'Consumer Cyclical':      ['consumer'],
  'Consumer Defensive':     ['consumer'],
  'Financial Services':     ['financial-services'],
  'Communication Services': ['media-entertainment'],
  'Energy':                 ['infrastructure-energy'],
  'Basic Materials':        ['industrials'],
  'Real Estate':            ['real-estate-proptech'],
  'Utilities':              ['infrastructure-energy']
};

// More specific GECS Industry Group → sector overrides
const GECS_GROUP_OVERRIDES = {
  'Software':                    ['technology-software'],
  'Hardware':                    ['technology-software'],
  'Semiconductors':              ['technology-software'],
  'Business Services':           ['business-services'],
  'Construction':                ['industrials'],
  'Industrial Products':         ['industrials'],
  'Industrial Distribution':     ['industrials'],
  'Manufacturing - Apparel & Accessories': ['consumer'],
  'Aerospace & Defense':         ['industrials'],
  'Medical Devices & Instruments': ['healthcare'],
  'Medical Diagnostics & Research': ['life-sciences'],
  'Biotechnology':               ['life-sciences'],
  'Pharmaceuticals':             ['life-sciences'],
  'Education':                   ['business-services'],
  'Media - Diversified':         ['media-entertainment'],
  'Telecommunication Services':  ['media-entertainment'],
  'Insurance':                   ['financial-services'],
  'Asset Management':            ['financial-services'],
  'Credit Services':             ['financial-services'],
  'Restaurants':                 ['consumer'],
  'Travel & Leisure':            ['consumer'],
  'Oil & Gas':                   ['infrastructure-energy'],
  'Packaging & Containers':      ['industrials'],
  'Chemicals':                   ['industrials'],
  'Waste Management':            ['industrials'],
  'Transportation & Logistics':  ['business-services'],
  'Personal Services':           ['consumer'],
  'Real Estate':                 ['real-estate-proptech'],
  'Food & Beverage':             ['consumer', 'agriculture-fb'],
  'Consumer Packaged Goods':     ['consumer'],
};

function getSectorIds(gecsSector, gecsGroup) {
  // Try specific group override first
  if (gecsGroup && GECS_GROUP_OVERRIDES[gecsGroup]) {
    return GECS_GROUP_OVERRIDES[gecsGroup];
  }
  // Fall back to sector mapping
  if (gecsSector && GECS_SECTOR_MAP[gecsSector]) {
    return GECS_SECTOR_MAP[gecsSector];
  }
  return [];
}

// ── Revenue string → revenue_tier ────────────────────────────────────────────

function parseRevenueTier(rev) {
  if (!rev && rev !== 0) return null;
  const num = typeof rev === 'number' ? rev : parseFloat(String(rev).replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return null;
  // PitchBook revenue is in millions
  if (num >= 1000) return '$1B+';
  if (num >= 500)  return '$500M-$1B';
  if (num >= 200)  return '$200M-$500M';
  if (num >= 50)   return '$50M-$200M';
  if (num >= 10)   return '$10M-$50M';
  return '<$10M';
}

// ── Parse Excel ──────────────────────────────────────────────────────────────

console.log('Loading PitchBook export...');
const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

// Find header row (row 7, 0-indexed)
const headerRow = rawData.findIndex(r => r && r[0] === 'Company ID');
if (headerRow === -1) { console.error('Could not find header row'); process.exit(1); }

const headers = rawData[headerRow];
const colIdx = {};
headers.forEach((h, i) => { if (h) colIdx[h] = i; });

const rows = rawData.slice(headerRow + 1).filter(r => r && r[colIdx['Company ID']]);
console.log(`  ${rows.length} companies found in export\n`);

// ── Load existing data ───────────────────────────────────────────────────────

const companyPool = JSON.parse(fs.readFileSync(companyPoolPath, 'utf8'));
const playbooks   = JSON.parse(fs.readFileSync(playbooksPath, 'utf8'));

// Build existing company index for dedup
const existingCompanyIndex = new Map();
companyPool.companies.forEach(c => {
  existingCompanyIndex.set(normCompanyName(c.name), c);
  (c.aliases || []).forEach(a => existingCompanyIndex.set(normCompanyName(a), c));
});

// ── Process each row ─────────────────────────────────────────────────────────

let newPoolEntries = 0;
let updatedPoolEntries = 0;
let playbookAssignments = 0;
const sectorCounts = {};

rows.forEach(row => {
  const name        = (row[colIdx['Companies']] || '').trim();
  if (!name) return;

  const companyId   = slugify(name);
  const employees   = parseInt(row[colIdx['Employees']]) || null;
  const description = (row[colIdx['Description']] || '').slice(0, 500).trim() || null;
  const gecsSector  = (row[colIdx['GECS Sector']] || '').trim();
  const gecsGroup   = (row[colIdx['GECS Industry Group']] || '').trim();
  const gecsIndustry = (row[colIdx['GECS Industry']] || '').trim();
  const hqCity      = (row[colIdx['HQ City']] || '').trim();
  const hqState     = (row[colIdx['HQ State/Province']] || '').trim();
  const hq          = [hqCity, hqState].filter(Boolean).join(', ') || null;
  const yearFounded = parseInt(row[colIdx['Year Founded']]) || null;
  const revenue     = row[colIdx['Revenue']];
  const revenueTier = parseRevenueTier(revenue);
  const revenueRaw  = typeof revenue === 'number' ? revenue : null;
  const activeInvestors = (row[colIdx['Active Investors']] || '').trim() || null;
  const alsoKnownAs = (row[colIdx['Company Also Known As']] || '').trim();
  const formerName  = (row[colIdx['Company Former Name']] || '').trim();
  const competitors = (row[colIdx['Competitors']] || '').trim() || null;
  const keywords    = (row[colIdx['Keywords']] || '').trim() || null;
  const verticals   = (row[colIdx['Verticals']] || '').trim() || null;
  const pbIndustrySector = (row[colIdx['Primary PitchBook Industry Sector']] || '').trim();
  const pbIndustryGroup = (row[colIdx['Primary PitchBook Industry Group']] || '').trim();
  const pbIndustryCode = (row[colIdx['Primary PitchBook Industry Code']] || '').trim();
  const empHistory   = (row[colIdx['Employee History']] || '').trim() || null;

  // Build aliases
  const aliases = [];
  if (alsoKnownAs) alsoKnownAs.split(',').forEach(a => { if (a.trim()) aliases.push(a.trim()); });
  if (formerName && formerName !== name) aliases.push(formerName);

  // Determine sector assignments
  const sectorIds = getSectorIds(gecsSector, gecsGroup);

  // ── Update or create in company pool ─────────────────────────────────────

  const norm = normCompanyName(name);
  let existing = existingCompanyIndex.get(norm);

  if (existing) {
    // Update with PitchBook data (only fill blanks)
    if (!existing.employee_count && employees) existing.employee_count = employees;
    if (!existing.description && description)  existing.description = description;
    if (!existing.hq && hq)                    existing.hq = hq;
    if (!existing.year_founded && yearFounded) existing.year_founded = yearFounded;
    if (!existing.revenue_tier && revenueTier) existing.revenue_tier = revenueTier;
    if (!existing.industry && gecsGroup)       existing.industry = gecsGroup;
    if (!existing.industry_sector && gecsSector) existing.industry_sector = gecsSector;

    // Always update GECS fields (more standardized)
    existing.gecs_sector = gecsSector || existing.gecs_sector || null;
    existing.gecs_industry_group = gecsGroup || existing.gecs_industry_group || null;
    existing.gecs_industry = gecsIndustry || existing.gecs_industry || null;

    // Update PE-specific fields
    if (activeInvestors && !existing.pe_sponsors) existing.pe_sponsors = activeInvestors;
    if (revenueRaw && !existing.revenue_millions) existing.revenue_millions = revenueRaw;
    if (competitors && !existing.competitors) existing.competitors = competitors;
    if (empHistory && !existing.employee_history) existing.employee_history = empHistory;

    // Set company type if not set
    if (!existing.company_type) existing.company_type = 'Portfolio Company';
    if (!existing.ownership_type) existing.ownership_type = 'PE-backed';

    // Merge aliases
    if (aliases.length && !existing.aliases) existing.aliases = [];
    if (existing.aliases) {
      aliases.forEach(a => { if (!existing.aliases.includes(a)) existing.aliases.push(a); });
    }

    existing.last_updated = today;
    existing.enrichment_status = existing.enrichment_status === 'enriched' ? 'enriched' : 'enriched';
    updatedPoolEntries++;
  } else {
    // Create new company pool entry
    const newCompany = {
      company_id:           companyId,
      company_type:         'Portfolio Company',
      name:                 name,
      aliases:              aliases,
      linkedin_company_url: null,
      hq:                   hq,
      website_url:          null,
      description:          description,
      year_founded:         yearFounded,
      notes:                '',
      date_added:           today,
      last_updated:         today,
      source:               'pitchbook-companies',
      enrichment_status:    'enriched',

      // Industry fields (GECS)
      industry:             gecsGroup || null,
      industry_sector:      gecsSector || null,
      gecs_sector:          gecsSector || null,
      gecs_industry_group:  gecsGroup || null,
      gecs_industry:        gecsIndustry || null,

      // Size & financials
      employee_count:       employees,
      revenue_tier:         revenueTier,
      revenue_millions:     revenueRaw,
      ownership_type:       'PE-backed',
      ticker:               null,
      parent_company:       null,

      // PE-specific
      pe_sponsors:          activeInvestors,
      competitors:          competitors,
      employee_history:     empHistory,
      keywords:             keywords,
      verticals:            verticals,

      // PitchBook industry codes
      pb_industry_sector:   pbIndustrySector || null,
      pb_industry_group:    pbIndustryGroup || null,
      pb_industry_code:     pbIndustryCode || null,

      // PE firm fields (null for portfolio companies)
      size_tier:            null,
      strategy:             null,
      entity_type:          null,
      investment_professionals: null,
      last_fund_name:       null,
      last_fund_size:       null,
      last_fund_vintage:    null,
      dry_powder:           null,
      preferred_ebitda_min: null,
      preferred_ebitda_max: null,
      preferred_geography:  null,
      active_portfolio_count: null,
      sector_focus_tags:    sectorIds
    };

    companyPool.companies.push(newCompany);
    existingCompanyIndex.set(norm, newCompany);
    newPoolEntries++;
  }

  // ── Add to sector playbooks as target_company ────────────────────────────

  sectorIds.forEach(sectorId => {
    sectorCounts[sectorId] = (sectorCounts[sectorId] || 0) + 1;

    const sector = playbooks.sectors.find(s => s.sector_id === sectorId);
    if (!sector) return;
    if (!sector.target_companies) sector.target_companies = [];

    // Check if already exists
    const exists = sector.target_companies.some(c =>
      c.company_id === companyId || normCompanyName(c.name) === norm
    );
    if (exists) return;

    sector.target_companies.push({
      company_id:         companyId,
      name:               name,
      hq:                 hq || '',
      revenue_tier:       revenueTier,
      ownership_type:     'PE-backed',
      industry:           gecsGroup || null,
      employee_count:     employees,
      pe_sponsors:        activeInvestors,
      why_target:         '',
      roles_to_target:    [],
      expected_roster_size: 5,
      roster:             [],
      roster_completeness: 'auto'
    });
    playbookAssignments++;
  });
});

// ── Populate top_companies per sector (top 25 by employee count) ─────────────

playbooks.sectors.forEach(sector => {
  if (!sector.target_companies || sector.target_companies.length === 0) return;
  if (!sector.top_companies) sector.top_companies = [];

  // Sort by employee count descending
  const ranked = [...sector.target_companies]
    .filter(c => c.employee_count && c.employee_count > 0)
    .sort((a, b) => (b.employee_count || 0) - (a.employee_count || 0));

  sector.top_companies = ranked.slice(0, 25).map(c => c.company_id);
});

// ── Write results ────────────────────────────────────────────────────────────

if (dryRun) {
  console.log('[DRY RUN] Would create/update:');
  console.log(`  New company pool entries: ${newPoolEntries}`);
  console.log(`  Updated company pool entries: ${updatedPoolEntries}`);
  console.log(`  Playbook assignments: ${playbookAssignments}`);
  console.log('\n  Sector distribution:');
  Object.entries(sectorCounts).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`    ${k}: ${v}`));
  console.log('\n  Top 25 companies per sector:');
  playbooks.sectors.forEach(s => {
    if (s.top_companies && s.top_companies.length > 0) {
      console.log(`    ${s.sector_name}: ${s.top_companies.length} ranked`);
    }
  });
} else {
  // Sort company pool alphabetically
  companyPool.companies.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  fs.writeFileSync(companyPoolPath, JSON.stringify(companyPool, null, 2), 'utf8');
  fs.writeFileSync(playbooksPath, JSON.stringify(playbooks, null, 2), 'utf8');

  console.log('Done!');
  console.log(`  New company pool entries: ${newPoolEntries}`);
  console.log(`  Updated company pool entries: ${updatedPoolEntries}`);
  console.log(`  Total companies in pool: ${companyPool.companies.length}`);
  console.log(`  Playbook target company assignments: ${playbookAssignments}`);
  console.log('\n  Sector distribution:');
  Object.entries(sectorCounts).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`    ${k}: ${v}`));
  console.log('\n  Top 25 companies per sector:');
  playbooks.sectors.forEach(s => {
    if (s.top_companies && s.top_companies.length > 0) {
      const top3 = s.top_companies.slice(0, 3).map(id => {
        const c = s.target_companies.find(tc => tc.company_id === id);
        return c ? `${c.name} (${c.employee_count})` : id;
      });
      console.log(`    ${s.sector_name}: ${s.top_companies.length} ranked — ${top3.join(', ')}...`);
    }
  });
}
