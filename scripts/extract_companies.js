'use strict';

/**
 * extract_companies.js
 *
 * Iterates through all candidates in the candidate pool, extracts unique
 * companies from their work_history, and creates stub entries in the company
 * pool for any companies not already present. Also backfills company_id
 * into work_history entries and marks existing PE firms as enriched.
 *
 * Usage: node scripts/extract_companies.js [--dry-run]
 */

const fs   = require('fs');
const path = require('path');
const { slugify, normCompanyName: normalizeName, extractLinkedInCompanySlug: extractLinkedInSlug } = require('../server/utils/shared');

const candidatePoolPath = path.join(__dirname, '../data/candidate_pool.json');
const companyPoolPath   = path.join(__dirname, '../data/company_pool.json');

const dryRun = process.argv.includes('--dry-run');

// ── Helpers ──────────────────────────────────────────────────────────────────

function isCorruptedName(s) {
  if (!s || s.trim().length < 2) return true;
  // Starts with digits + duration pattern (e.g. "3 yrs 2 mos")
  if (/^\d+\s*(yrs?|mos?|years?|months?)/i.test(s.trim())) return true;
  // Pure numbers
  if (/^\d+$/.test(s.trim())) return true;
  // Skills/activities text or job titles that got misclassified as company names
  if (/^(activities and societies|project management|skills?:|endorsement)/i.test(s.trim())) return true;
  // Common job titles that appear as company names due to scraper bugs
  if (/^(chief executive officer|chief operating officer|chief financial officer|president|vice president|managing director|partner|senior associate|associate|analyst|consultant|board member|board observer|advisory board|member)$/i.test(s.trim())) return true;
  return false;
}

// ── Load data ────────────────────────────────────────────────────────────────

console.log('Loading data...');
const candidateData = JSON.parse(fs.readFileSync(candidatePoolPath, 'utf8'));
const companyData   = JSON.parse(fs.readFileSync(companyPoolPath, 'utf8'));

const candidates = candidateData.candidates || [];
const existingCompanies = companyData.companies || [];

console.log(`  ${candidates.length} candidates`);
console.log(`  ${existingCompanies.length} existing companies`);

// ── Phase 0: Mark existing PE firms as enriched ─────────────────────────────

let peEnrichedCount = 0;
existingCompanies.forEach(c => {
  if (!c.enrichment_status) {
    c.enrichment_status = (c.company_type === 'PE Firm' && c.description) ? 'enriched' : 'pending';
    if (c.enrichment_status === 'enriched') peEnrichedCount++;
  }
});
console.log(`  Marked ${peEnrichedCount} existing PE firms as enriched`);

// ── Build index of existing companies ────────────────────────────────────────

// Map of normalized name -> company record
const nameIndex = new Map();
// Map of LinkedIn company URL slug -> company record
const urlIndex = new Map();

existingCompanies.forEach(c => {
  const norm = normalizeName(c.name);
  if (norm) nameIndex.set(norm, c);
  // Also index aliases
  (c.aliases || []).forEach(alias => {
    const normAlias = normalizeName(alias);
    if (normAlias) nameIndex.set(normAlias, c);
  });
  // Index LinkedIn URL
  const slug = extractLinkedInSlug(c.linkedin_company_url);
  if (slug) urlIndex.set(slug, c);
});

function findExistingCompany(companyName, linkedinUrl) {
  // Try LinkedIn URL first (most reliable)
  const slug = extractLinkedInSlug(linkedinUrl);
  if (slug && urlIndex.has(slug)) return urlIndex.get(slug);

  // Try normalized name
  const norm = normalizeName(companyName);
  if (norm && nameIndex.has(norm)) return nameIndex.get(norm);

  // Try substring match (shorter must be >= 60% of longer)
  if (norm && norm.length >= 4) {
    for (const [key, company] of nameIndex) {
      if (key.length < 4) continue;
      const shorter = norm.length <= key.length ? norm : key;
      const longer = norm.length > key.length ? norm : key;
      if (longer.includes(shorter) && shorter.length >= longer.length * 0.6) {
        return company;
      }
    }
  }

  return null;
}

// ── Extract companies from work histories ────────────────────────────────────

console.log('\nExtracting companies from candidate work histories...');

// Map: normalized name -> { names: Set, linkedinUrls: Set, logoUrls: Set, count: number }
const newCompanyMap = new Map();
let linkedCount = 0;
let skippedCount = 0;

candidates.forEach(candidate => {
  const wh = candidate.work_history || [];
  wh.forEach(entry => {
    const companyName = (entry.company || '').trim();
    if (!companyName || isCorruptedName(companyName)) {
      skippedCount++;
      return;
    }

    const linkedinUrl = entry.companyLinkedInUrl || null;
    const existing = findExistingCompany(companyName, linkedinUrl);

    if (existing) {
      // Link work_history entry to existing company
      entry.company_id = existing.company_id;
      linkedCount++;

      // Update existing company's LinkedIn URL if we have one and they don't
      if (linkedinUrl && !existing.linkedin_company_url) {
        existing.linkedin_company_url = linkedinUrl;
        const slug = extractLinkedInSlug(linkedinUrl);
        if (slug) urlIndex.set(slug, existing);
      }
      return;
    }

    // New company — add to map
    const norm = normalizeName(companyName);
    if (!norm) return;

    if (!newCompanyMap.has(norm)) {
      newCompanyMap.set(norm, {
        names: new Set(),
        linkedinUrls: new Set(),
        logoUrls: new Set(),
        count: 0
      });
    }
    const info = newCompanyMap.get(norm);
    info.names.add(companyName);
    if (linkedinUrl) info.linkedinUrls.add(linkedinUrl);
    if (entry.logoUrl) info.logoUrls.add(entry.logoUrl);
    info.count++;
  });
});

console.log(`  ${linkedCount} work_history entries linked to existing companies`);
console.log(`  ${skippedCount} entries skipped (empty/corrupted)`);
console.log(`  ${newCompanyMap.size} new unique companies found`);

// ── Create company stubs ─────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const usedSlugs = new Set(existingCompanies.map(c => c.company_id));
const newCompanies = [];

newCompanyMap.forEach((info, norm) => {
  // Pick the most common name spelling
  const nameArr = [...info.names];
  const bestName = nameArr.sort((a, b) => {
    // Prefer the longest non-corrupted version
    return b.length - a.length;
  })[0];

  // Generate unique slug
  let slug = slugify(bestName);
  if (usedSlugs.has(slug)) {
    let counter = 2;
    while (usedSlugs.has(slug + '-' + counter)) counter++;
    slug = slug + '-' + counter;
  }
  usedSlugs.add(slug);

  const linkedinUrl = info.linkedinUrls.size > 0 ? [...info.linkedinUrls][0] : null;
  const aliases = nameArr.length > 1 ? nameArr.filter(n => n !== bestName) : [];

  const stub = {
    company_id:               slug,
    company_type:             null,
    name:                     bestName,
    aliases:                  aliases,
    linkedin_company_url:     linkedinUrl,
    hq:                       null,
    website_url:              null,
    description:              null,
    year_founded:             null,
    notes:                    '',
    date_added:               today,
    last_updated:             today,
    source:                   'candidate-extraction',
    enrichment_status:        'pending',

    // PE fields (null for non-PE)
    size_tier:                null,
    strategy:                 null,
    entity_type:              null,
    investment_professionals: null,
    last_fund_name:           null,
    last_fund_size:           null,
    last_fund_vintage:        null,
    dry_powder:               null,
    preferred_ebitda_min:     null,
    preferred_ebitda_max:     null,
    preferred_geography:      null,
    active_portfolio_count:   null,
    sector_focus_tags:        [],

    // Non-PE fields (to be filled by enrichment)
    revenue_tier:             null,
    ownership_type:           null,
    parent_company:           null,
    employee_count:           null,
    industry:                 null,
    ticker:                   null
  };

  newCompanies.push(stub);

  // Index the new company so work_history linking works
  nameIndex.set(norm, stub);
  if (linkedinUrl) {
    const s = extractLinkedInSlug(linkedinUrl);
    if (s) urlIndex.set(s, stub);
  }
});

// ── Second pass: link remaining work_history entries to newly created companies ─

let secondPassLinked = 0;
candidates.forEach(candidate => {
  const wh = candidate.work_history || [];
  wh.forEach(entry => {
    if (entry.company_id) return; // already linked
    const companyName = (entry.company || '').trim();
    if (!companyName || isCorruptedName(companyName)) return;

    const existing = findExistingCompany(companyName, entry.companyLinkedInUrl);
    if (existing) {
      entry.company_id = existing.company_id;
      secondPassLinked++;
    }
  });
});

console.log(`  ${secondPassLinked} additional work_history entries linked (second pass)`);

// ── Write results ────────────────────────────────────────────────────────────

if (dryRun) {
  console.log('\n[DRY RUN] Would create:');
  newCompanies.slice(0, 20).forEach(c => console.log(`  - ${c.name} (${c.company_id})`));
  if (newCompanies.length > 20) console.log(`  ... and ${newCompanies.length - 20} more`);
} else {
  // Append new companies to existing pool
  const allCompanies = [...existingCompanies, ...newCompanies];
  allCompanies.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  fs.writeFileSync(companyPoolPath, JSON.stringify({ companies: allCompanies }, null, 2), 'utf8');
  fs.writeFileSync(candidatePoolPath, JSON.stringify(candidateData, null, 2), 'utf8');

  console.log(`\nDone!`);
  console.log(`  New companies created: ${newCompanies.length}`);
  console.log(`  Total companies in pool: ${allCompanies.length}`);
  console.log(`  Work history entries linked: ${linkedCount + secondPassLinked}`);
  console.log(`  Output: ${companyPoolPath}`);
}
