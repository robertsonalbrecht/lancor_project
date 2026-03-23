'use strict';

const fs   = require('fs');
const path = require('path');

const playbooksPath   = path.join(__dirname, '../data/sector_playbooks.json');
const companyPoolPath = path.join(__dirname, '../data/company_pool.json');

const playbooks = JSON.parse(fs.readFileSync(playbooksPath, 'utf8'));

// firmId -> { company record, sectorIds[], populatedCount }
const firmMap = new Map();

playbooks.sectors.forEach(sector => {
  (sector.pe_firms || []).forEach(firm => {
    const id = firm.firm_id;
    if (!id) return;

    const populatedCount = Object.values(firm).filter(v =>
      v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
    ).length;

    if (!firmMap.has(id)) {
      firmMap.set(id, { firm, sectorIds: [sector.sector_id], populatedCount });
    } else {
      const existing = firmMap.get(id);
      existing.sectorIds.push(sector.sector_id);
      // Keep the record with the most populated fields
      if (populatedCount > existing.populatedCount) {
        existing.firm = firm;
        existing.populatedCount = populatedCount;
      }
    }
  });
});

const today = new Date().toISOString().slice(0, 10);

const companies = [];
firmMap.forEach(({ firm, sectorIds }) => {
  companies.push({
    company_id:               firm.firm_id,
    company_type:             'PE Firm',
    name:                     firm.name            || '',
    hq:                       firm.hq              || '',
    website_url:              firm.website_url     || '',
    description:              firm.description     || '',
    year_founded:             firm.year_founded    || null,
    notes:                    '',
    date_added:               today,
    last_updated:             today,
    source:                   'playbook-seed',

    // PE Firm fields
    size_tier:                firm.size_tier       || null,
    strategy:                 firm.strategy        || null,
    entity_type:              firm.entity_type     || null,
    investment_professionals: firm.investment_professionals || null,
    last_fund_name:           firm.last_fund_name  || '',
    last_fund_size:           firm.last_fund_size  || null,
    last_fund_vintage:        firm.last_fund_vintage || null,
    dry_powder:               firm.dry_powder      || null,
    preferred_ebitda_min:     firm.preferred_ebitda_min || null,
    preferred_ebitda_max:     firm.preferred_ebitda_max || null,
    preferred_geography:      firm.preferred_geography || '',
    active_portfolio_count:   firm.active_portfolio_count || null,
    sector_focus_tags:        sectorIds,

    // Private/Public fields (null for PE firms)
    revenue_tier:             null,
    ownership_type:           null,
    parent_company:           null,
    employee_count:           null,
    industry:                 null,
    ticker:                   null
  });
});

// Sort alphabetically
companies.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(companyPoolPath, JSON.stringify({ companies }, null, 2), 'utf8');

console.log(`Seed complete.`);
console.log(`  Unique firms written: ${companies.length}`);
console.log(`  Total playbook entries processed: ${[...firmMap.values()].reduce((n, v) => n + v.sectorIds.length, 0)}`);
console.log(`  Output: ${companyPoolPath}`);
