'use strict';

/**
 * import_pitchbook.js
 * Parses All private equity firms above 50 million.xlsx and enriches sector_playbooks.json
 */

const XLSX   = require('xlsx');
const fs     = require('fs');
const path   = require('path');

const EXCEL_FILE  = path.join(__dirname, '..', 'All private equity firms above 50 million.xlsx');
const PB_FILE     = path.join(__dirname, '..', 'data', 'sector_playbooks.json');
const SUMMARY_OUT = path.join(__dirname, '..', 'data', 'import_summary.txt');

// ── KEEP / SKIP investor types ────────────────────────────────────────────────

const KEEP_TYPES = new Set([
  'PE/Buyout', 'Growth/Expansion', 'Mezzanine', 'Other Private Equity',
  'Fundless Sponsor', 'Merchant Banking Firm', 'Infrastructure', 'Impact Investing'
]);

const SKIP_TYPES = new Set([
  'Accelerator/Incubator', 'Asset Manager', 'Business Development Company',
  'Corporate Venture Capital', 'Corporation', 'Fund of Funds', 'Government',
  'Hedge Fund', 'Holding Company', 'Investment Bank', 'Limited Partner',
  'Mutual Fund', 'Not-For-Profit Venture Capital', 'Other', 'PE-Backed Company',
  'Real Estate', 'SBIC', 'Secondary Buyer', 'VC-Backed Company', 'Venture Capital'
]);

// ── Entity type map ───────────────────────────────────────────────────────────

function deriveEntityType(primaryType, otherTypes, parentCompany, firmName) {
  const nameLC = (firmName || '').toLowerCase();
  const institutionalNames = [
    'goldman', 'morgan stanley', 'blackrock', 'jpmorgan', 'jp morgan',
    'citigroup', 'wells fargo', 'barclays', 'deutsche bank', 'credit suisse',
    'ubs', 'hsbc', 'bnp', 'societe generale'
  ];

  const typeMap = {
    'PE/Buyout':           'Dedicated PE Firm',
    'Growth/Expansion':    'Growth Equity Firm',
    'Venture Capital':     'Venture Capital Firm',
    'Mezzanine':           'Credit / Distressed Firm',
    'Lender/Debt Provider':'Credit / Distressed Firm',
    'Other Private Equity':'Dedicated PE Firm',
    'Fundless Sponsor':    'Dedicated PE Firm',
    'Merchant Banking Firm':'PE Division of Larger Firm',
    'Infrastructure':      'Infrastructure Fund',
    'Impact Investing':    'Impact / ESG Fund',
    'Asset Manager':       'Asset Manager with PE Wing',
    'Hedge Fund':          'Asset Manager with PE Wing',
    'Investment Bank':     'PE Division of Larger Firm',
    'Family Office':       'Family Office',
    'Fund of Funds':       'Fund of Funds',
    'Real Estate':         'Real Estate Fund',
    'SBIC':                'Dedicated PE Firm',
    'Secondary Buyer':     'Secondary Fund',
  };

  let entityType = typeMap[primaryType] || 'Dedicated PE Firm';

  // Refinement: override to PE Division if parent company exists or institutional name
  if (entityType === 'Dedicated PE Firm') {
    if (parentCompany && parentCompany.toString().trim()) {
      entityType = 'PE Division of Larger Firm';
    } else if (institutionalNames.some(n => nameLC.includes(n))) {
      entityType = 'PE Division of Larger Firm';
    }
  }

  return entityType;
}

// ── Strategy derivation ───────────────────────────────────────────────────────

function deriveStrategy(primaryType) {
  const t = (primaryType || '').toLowerCase();
  if (t.includes('distressed') || t.includes('credit')) return 'Distressed';
  if (t.includes('mezzanine'))                           return 'Distressed';
  if (t.includes('growth') || t.includes('expansion'))  return 'Growth Equity';
  if (t.includes('venture'))                             return 'Growth Equity';
  if (t.includes('buyout'))                              return 'Buyout';
  return 'Buyout';
}

// ── Size tier from AUM ────────────────────────────────────────────────────────

function deriveSizeTier(aum) {
  const n = parseNum(aum);
  if (n === null) return 'Lower Middle Market';
  if (n >= 10000) return 'Mega';
  if (n >= 3000)  return 'Large';
  if (n >= 500)   return 'Middle Market';
  return 'Lower Middle Market';
}

// ── Expected roster size ──────────────────────────────────────────────────────

function deriveRosterSize(investmentProfs, sizeTier) {
  const n = parseNum(investmentProfs);
  if (n !== null) {
    if (n < 10)  return 3;
    if (n <= 30) return 6;
    if (n <= 75) return 11;
    return 18;
  }
  const tierMap = { 'Mega': 22, 'Large': 11, 'Middle Market': 6, 'Lower Middle Market': 3 };
  return tierMap[sizeTier] || 3;
}

// ── Numeric parsing ───────────────────────────────────────────────────────────

function parseNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

// ── Date parsing (Excel serial or string) ─────────────────────────────────────

function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel date serial
    const d = XLSX.SSF.parse_date_code(val);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }
  }
  const s = String(val).trim();
  // "Expected 31-Mar-2026" or "31-Mar-2026" style
  const match = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (match) {
    const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                    Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    return `${match[3]}-${months[match[2]] || '01'}-${String(match[1]).padStart(2,'0')}`;
  }
  // "2024-03" or ISO-like
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// ── Name normalization for dedup ──────────────────────────────────────────────

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    // remove stock ticker e.g. "(NYS: BX)"
    .replace(/\s*\([a-z]+:\s*[a-z0-9]+\)/gi, '')
    // remove common suffixes
    .replace(/\b(inc\.?|llc\.?|lp\.?|l\.p\.?|ltd\.?|limited|group|partners|capital|management|advisors?|investments?|fund|equity|holdings?|corp\.?|co\.?|gmbh|llp\.?)\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatchScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 3;
  if (na.includes(nb) || nb.includes(na)) return 2;
  // First significant word match
  const wa = na.split(' ')[0];
  const wb2 = nb.split(' ')[0];
  if (wa.length >= 3 && wa === wb2) return 1;
  return 0;
}

// ── Sector keyword matching ───────────────────────────────────────────────────

const SECTOR_KEYWORDS = {
  'industrials': [
    'industrial', 'manufacturing', 'aerospace', 'chemicals', 'metals',
    'distribution', 'packaging', 'automotive', 'capital goods',
    'materials', 'defense', 'energy services', 'engineered products',
    'flow control', 'sensors', 'specialty materials'
  ],
  'technology-software': [
    'software', 'saas', 'cybersecurity', 'data analytics',
    'enterprise software', 'infrastructure software',
    'application software', 'hardware', 'internet', 'semiconductors',
    'cloud', 'devops', 'it infrastructure', 'artificial intelligence',
    'machine learning', 'data & analytics'
  ],
  'tech-enabled-services': [
    'tech-enabled', 'technology-enabled', 'it services',
    'it consulting', 'managed services', 'bpo', 'business process',
    'tech services', 'digital services', 'technology services',
    'it outsourcing', 'digital transformation'
  ],
  'healthcare': [
    'healthcare', 'health care', 'medical', 'hospital', 'physician',
    'dental', 'behavioral health', 'health services', 'healthtech',
    'med tech', 'medical devices', 'diagnostics', 'home health',
    'post-acute', 'specialty pharmacy', 'health plans'
  ],
  'financial-services': [
    'financial services', 'insurance', 'banking', 'fintech',
    'wealth management', 'asset management', 'payments',
    'capital markets', 'credit services', 'mortgage',
    'real estate finance', 'specialty finance', 'insurtech'
  ],
  'consumer': [
    'consumer', 'retail', 'restaurant', 'food & beverage',
    'e-commerce', 'beauty', 'personal care', 'apparel', 'home goods',
    'pet', 'sports', 'luxury', 'hospitality', 'travel', 'fitness',
    'direct-to-consumer', 'food service'
  ],
  'business-services': [
    'business services', 'government services',
    'professional services', 'human capital', 'staffing',
    'workforce', 'education', 'training', 'legal services',
    'marketing services', 'facilities', 'environmental',
    'outsourcing', 'testing & inspection', 'certification'
  ],
  'infrastructure-energy': [
    'infrastructure', 'energy', 'utilities', 'renewables', 'power',
    'oil & gas', 'transportation', 'logistics', 'water',
    'waste management', 'natural resources',
    'telecom infrastructure', 'data centers', 'midstream',
    'pipelines', 'fiber networks'
  ],
  'life-sciences': [
    'life sciences', 'biopharma', 'pharmaceutical', 'biotech',
    'drug discovery', 'clinical', 'genomics', 'medical research',
    'cell therapy', 'diagnostics tools', 'lab services'
  ],
  'media-entertainment': [
    'media', 'entertainment', 'sports', 'gaming', 'content',
    'publishing', 'broadcasting', 'music', 'film', 'television',
    'digital media', 'streaming', 'live events', 'podcasting'
  ],
  'real-estate-proptech': [
    'real estate', 'proptech', 'property', 'reit',
    'commercial real estate', 'residential', 'construction',
    'architecture', 'facilities management', 'title services'
  ],
  'agriculture-fb': [
    'agriculture', 'agribusiness', 'food & beverage',
    'food production', 'farming', 'agtech', 'food supply',
    'crop sciences', 'animal nutrition', 'food ingredients'
  ]
};

// Pre-compile: for each sector, build sorted-by-length-desc keywords (longer phrases first)
const SECTOR_PATTERNS = {};
for (const [sectorId, keywords] of Object.entries(SECTOR_KEYWORDS)) {
  SECTOR_PATTERNS[sectorId] = [...keywords].sort((a, b) => b.length - a.length);
}

function assignSectors(row, hdrs) {
  const fieldIndices = [
    hdrs.indexOf('Preferred Industry'),
    hdrs.indexOf('Preferred Verticals'),
    hdrs.indexOf('Primary PitchBook Industry Sector'),
    hdrs.indexOf('All PitchBook Industries'),
    hdrs.indexOf('Keywords'),
    hdrs.indexOf('Description'),
  ];

  const text = fieldIndices
    .map(i => (i >= 0 && row[i]) ? String(row[i]) : '')
    .join(' ')
    .toLowerCase();

  const matched = [];
  for (const [sectorId, keywords] of Object.entries(SECTOR_PATTERNS)) {
    if (keywords.some(kw => text.includes(kw))) {
      matched.push(sectorId);
    }
  }
  return matched;
}

// ── Strip ticker from firm name ───────────────────────────────────────────────

function cleanName(raw) {
  return (raw || '').replace(/\s*\([A-Z]+:\s*[A-Z0-9]+\)\s*/g, '').trim();
}

// ── Generate firm_id from name ────────────────────────────────────────────────

function toFirmId(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('Reading Excel file…');
  const wb   = XLSX.readFile(EXCEL_FILE);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const hdrs = rows[7];
  const data = rows.slice(8).filter(r => r[1]); // skip blank rows

  const col = name => hdrs.indexOf(name);

  console.log(`Total rows: ${data.length}`);

  // Load existing playbooks
  const pb     = JSON.parse(fs.readFileSync(PB_FILE, 'utf8'));
  const sectors = pb.sectors || [];

  // Build existing firm index: sectorId -> { normalizedName -> firm }
  const existingBySector = {};
  for (const s of sectors) {
    existingBySector[s.sector_id] = {};
    for (const f of (s.pe_firms || [])) {
      existingBySector[s.sector_id][normalizeName(f.name)] = f;
    }
  }

  // Build flat set of all existing firm names for dedup
  const allExistingFirms = {}; // normalizedName -> { sectorId, firm }
  for (const s of sectors) {
    for (const f of (s.pe_firms || [])) {
      const nn = normalizeName(f.name);
      if (!allExistingFirms[nn]) allExistingFirms[nn] = [];
      allExistingFirms[nn].push({ sectorId: s.sector_id, firm: f });
    }
  }

  // Track stats
  const stats = {
    total: data.length,
    skippedInactive: 0,
    skippedType: 0,
    skippedNoActivity: 0,
    added: 0,
    updated: 0,
    noSector: [],
    addedPerSector: {},
    errors: [],
  };

  // Track new firms to add: sectorId -> array of firms
  const toAdd = {};
  // Track existing firm updates
  const toUpdate = []; // { sectorId, firmNorm, updates }

  for (const row of data) {
    try {
      const primaryType = (row[col('Primary Investor Type')] || '').trim();
      const otherTypes  = (row[col('Other Investor Types')]  || '').trim();
      const status      = (row[col('Investor Status')]        || '').trim();
      const aum         = row[col('AUM')];
      const inv5yr      = row[col('Investments in the last 5 years')];
      const rawName     = row[col('Investors')] || '';

      // ── Filter: investor status ──────────────────────────────────────────
      if (status && status !== 'Actively Seeking New Investments') {
        stats.skippedInactive++;
        continue;
      }

      // ── Filter: no AUM and no investment activity ───────────────────────
      const aumN   = parseNum(aum);
      const inv5N  = parseNum(inv5yr);
      if (aumN === null && (inv5N === null || inv5N === 0)) {
        stats.skippedNoActivity++;
        continue;
      }

      // ── Filter: investor type ────────────────────────────────────────────
      const otherArr = otherTypes.split(',').map(s => s.trim()).filter(Boolean);
      const otherHasPE = otherArr.some(t => t === 'PE/Buyout' || t === 'Growth/Expansion');

      let keepFirm = false;
      let flaggedEntityType = null;

      if (KEEP_TYPES.has(primaryType)) {
        keepFirm = true;
      } else if (SKIP_TYPES.has(primaryType)) {
        if (otherHasPE) {
          keepFirm = true;
          // Flag entity type
          if (primaryType === 'Asset Manager') flaggedEntityType = 'Asset Manager with PE Wing';
          else if (primaryType === 'Investment Bank') flaggedEntityType = 'PE Division of Larger Firm';
          else if (primaryType === 'Hedge Fund') flaggedEntityType = 'Asset Manager with PE Wing';
          else flaggedEntityType = 'Asset Manager with PE Wing';
        }
      }

      if (!keepFirm) {
        stats.skippedType++;
        continue;
      }

      // ── Build firm object ────────────────────────────────────────────────
      const name = cleanName(rawName);
      if (!name) continue;

      const hqCity     = (row[col('HQ City')]            || '').trim();
      const hqState    = (row[col('HQ State/Province')]  || '').trim();
      const hqCountry  = (row[col('HQ Country/Territory/Region')] || '').trim();
      const hq = hqCity && hqState ? `${hqCity}, ${hqState}`
               : hqCity            ? hqCity
               : hqCountry         ? hqCountry
               : '';

      const sizeTier   = deriveSizeTier(aum);
      const strategy   = deriveStrategy(primaryType);
      const parentCo   = row[col('Parent Company')];
      const entityType = flaggedEntityType || deriveEntityType(primaryType, otherTypes, parentCo, name);
      const rosterSize = deriveRosterSize(row[col('# of Investment Professionals')], sizeTier);

      const firmData = {
        name,
        hq,
        website_url:              (row[col('Website')]                     || '').trim() || null,
        year_founded:             parseNum(row[col('Year Founded')])        || null,
        description:              row[col('Description')]
                                    ? String(row[col('Description')]).slice(0, 300).trim()
                                    : null,
        investment_professionals: parseNum(row[col('# of Investment Professionals')]),
        ownership_status:         (row[col('Ownership Status')]             || '').trim() || null,
        investor_status:          status || null,
        entity_type:              entityType,
        size_tier:                sizeTier,
        strategy,
        preferred_deal_size_min:  parseNum(row[col('Preferred Deal Size Min')]),
        preferred_deal_size_max:  parseNum(row[col('Preferred Deal Size Max')]),
        preferred_revenue_min:    parseNum(row[col('Preferred Revenue Min')]),
        preferred_revenue_max:    parseNum(row[col('Preferred Revenue Max')]),
        preferred_ebitda_min:     parseNum(row[col('Preferred EBITDA Min')]),
        preferred_ebitda_max:     parseNum(row[col('Preferred EBITDA Max')]),
        preferred_investment_min: parseNum(row[col('Preferred Investment Amount Min')]),
        preferred_investment_max: parseNum(row[col('Preferred Investment Amount Max')]),
        preferred_geography:      (row[col('Preferred Geography')]          || '').trim() || null,
        last_investment_date:     parseDate(row[col('Last Investment Date')]),
        investments_last_2yr:     parseNum(row[col('Investments in the last 2 years')]),
        active_portfolio_count:   parseNum(row[col('Total Active Portfolio')]),
        dry_powder:               parseNum(row[col('Dry Powder')]),
        last_fund_name:           (row[col('Last Closed Fund Name')]        || '').trim() || null,
        last_fund_size:           parseNum(row[col('Last Closed Fund Size')]),
        last_fund_vintage:        parseNum(row[col('Last Closed Fund Vintage')]),
      };

      // ── Sector assignment ────────────────────────────────────────────────
      const assignedSectors = assignSectors(row, hdrs);

      // ── Deduplication ────────────────────────────────────────────────────
      const firmNorm = normalizeName(name);

      // Find best match across all existing firms
      let matchEntry = null;
      let bestScore = 0;

      for (const [existNorm, entries] of Object.entries(allExistingFirms)) {
        // Skip empty normalized names — they'd false-match via String.includes('')
        if (!existNorm || !firmNorm) continue;

        let directScore = 0;
        if (existNorm === firmNorm) {
          directScore = 3;
        } else if (
          // Containment only counts when the shorter token is at least 4 chars
          firmNorm.length >= 4 && existNorm.includes(firmNorm)
        ) {
          directScore = 2;
        } else if (
          existNorm.length >= 4 && firmNorm.includes(existNorm)
        ) {
          directScore = 2;
        }
        if (directScore > bestScore) {
          bestScore = directScore;
          matchEntry = entries;
        }
      }

      if (bestScore >= 2 && matchEntry) {
        // UPDATE existing firms (one PitchBook row may touch the same firm in multiple sectors)
        let anyUpdate = false;
        for (const { sectorId, firm } of matchEntry) {
          const updates = {};
          const updateIfBlank = (key, val) => {
            if (val !== null && val !== undefined && val !== '' &&
                (firm[key] === null || firm[key] === undefined || firm[key] === '')) {
              updates[key] = val;
            }
          };
          updateIfBlank('website_url',              firmData.website_url);
          updateIfBlank('year_founded',             firmData.year_founded);
          // Only fill description if why_target is blank
          if (!firm.why_target) updateIfBlank('description', firmData.description);
          updateIfBlank('investment_professionals', firmData.investment_professionals);
          updateIfBlank('entity_type',              firmData.entity_type);
          updateIfBlank('ownership_status',         firmData.ownership_status);
          updateIfBlank('preferred_deal_size_min',  firmData.preferred_deal_size_min);
          updateIfBlank('preferred_deal_size_max',  firmData.preferred_deal_size_max);
          updateIfBlank('preferred_revenue_min',    firmData.preferred_revenue_min);
          updateIfBlank('preferred_revenue_max',    firmData.preferred_revenue_max);
          updateIfBlank('preferred_ebitda_min',     firmData.preferred_ebitda_min);
          updateIfBlank('preferred_ebitda_max',     firmData.preferred_ebitda_max);
          updateIfBlank('preferred_investment_min', firmData.preferred_investment_min);
          updateIfBlank('preferred_investment_max', firmData.preferred_investment_max);
          updateIfBlank('preferred_geography',      firmData.preferred_geography);
          updateIfBlank('last_investment_date',     firmData.last_investment_date);
          updateIfBlank('investments_last_2yr',     firmData.investments_last_2yr);
          updateIfBlank('active_portfolio_count',   firmData.active_portfolio_count);
          updateIfBlank('dry_powder',               firmData.dry_powder);
          updateIfBlank('last_fund_name',           firmData.last_fund_name);
          updateIfBlank('last_fund_size',           firmData.last_fund_size);
          updateIfBlank('last_fund_vintage',        firmData.last_fund_vintage);
          // Never overwrite: roster, sector_focus, roster_completeness, manual_complete_note,
          //                  why_target (if set), size_tier (if set)
          if (Object.keys(updates).length > 0) {
            Object.assign(firm, updates);
            anyUpdate = true;
          }
        }
        if (anyUpdate) stats.updated++;
      } else {
        // NEW firm — add to each assigned sector
        if (assignedSectors.length === 0) {
          stats.noSector.push(name);
        }

        for (const sectorId of assignedSectors) {
          const sectorObj = sectors.find(s => s.sector_id === sectorId);
          if (!sectorObj) continue;

          // Check for duplicates within this specific sector (by normalized name)
          const alreadyInSector = (sectorObj.pe_firms || []).some(
            f => normalizeName(f.name) === firmNorm
          );
          if (alreadyInSector) continue;

          const firmId = toFirmId(name);
          const newFirm = {
            firm_id:              firmId,
            name,
            hq,
            size_tier:            firmData.size_tier,
            strategy:             firmData.strategy,
            sector_focus:         'Opportunistic',
            entity_type:          firmData.entity_type,
            website_url:          firmData.website_url,
            year_founded:         firmData.year_founded,
            description:          firmData.description,
            investment_professionals: firmData.investment_professionals,
            ownership_status:     firmData.ownership_status,
            preferred_deal_size_min:  firmData.preferred_deal_size_min,
            preferred_deal_size_max:  firmData.preferred_deal_size_max,
            preferred_revenue_min:    firmData.preferred_revenue_min,
            preferred_revenue_max:    firmData.preferred_revenue_max,
            preferred_ebitda_min:     firmData.preferred_ebitda_min,
            preferred_ebitda_max:     firmData.preferred_ebitda_max,
            preferred_investment_min: firmData.preferred_investment_min,
            preferred_investment_max: firmData.preferred_investment_max,
            preferred_geography:      firmData.preferred_geography,
            last_investment_date:     firmData.last_investment_date,
            investments_last_2yr:     firmData.investments_last_2yr,
            active_portfolio_count:   firmData.active_portfolio_count,
            dry_powder:               firmData.dry_powder,
            last_fund_name:           firmData.last_fund_name,
            last_fund_size:           firmData.last_fund_size,
            last_fund_vintage:        firmData.last_fund_vintage,
            why_target:               null,
            expected_roster_size:     rosterSize,
            roster:                   [],
            roster_completeness:      'auto',
            manual_complete_note:     null,
          };

          if (!sectorObj.pe_firms) sectorObj.pe_firms = [];
          sectorObj.pe_firms.push(newFirm);

          // Also update allExistingFirms to avoid double-adding across sectors
          if (!allExistingFirms[firmNorm]) allExistingFirms[firmNorm] = [];
          allExistingFirms[firmNorm].push({ sectorId, firm: newFirm });

          stats.added++;
          stats.addedPerSector[sectorId] = (stats.addedPerSector[sectorId] || 0) + 1;
        }
      }
    } catch (err) {
      stats.errors.push(`Row for "${row[1]}": ${err.message}`);
    }
  }

  // ── Write sector_playbooks.json ───────────────────────────────────────────
  console.log('Writing sector_playbooks.json…');
  fs.writeFileSync(PB_FILE, JSON.stringify(pb, null, 2), 'utf8');

  // ── Validation ────────────────────────────────────────────────────────────
  console.log('\n── VALIDATION ──');
  const reloaded = JSON.parse(fs.readFileSync(PB_FILE, 'utf8'));
  const allSectorIds = new Set(reloaded.sectors.map(s => s.sector_id));
  const EXPECTED_SECTORS = [
    'industrials','technology-software','tech-enabled-services','healthcare',
    'financial-services','consumer','business-services','infrastructure-energy',
    'life-sciences','media-entertainment','real-estate-proptech','agriculture-fb'
  ];
  for (const id of EXPECTED_SECTORS) {
    if (!allSectorIds.has(id)) console.warn('MISSING SECTOR:', id);
  }
  console.log(`All 12 sectors present: ${EXPECTED_SECTORS.every(id => allSectorIds.has(id))}`);

  // Check for duplicates within each sector
  let dupCount = 0;
  for (const s of reloaded.sectors) {
    const seen = new Set();
    for (const f of (s.pe_firms || [])) {
      const nn = normalizeName(f.name);
      if (seen.has(nn)) { dupCount++; console.warn(`DUPLICATE in ${s.sector_id}: ${f.name}`); }
      seen.add(nn);
    }
  }
  console.log(`Duplicates within sectors: ${dupCount}`);

  // Firm counts per sector
  let totalUnique = 0;
  const allFirmNamesAcrossSectors = new Set();
  console.log('\nFirm counts per sector:');
  for (const s of reloaded.sectors) {
    const count = (s.pe_firms || []).length;
    console.log(`  ${s.sector_id.padEnd(25)} ${count}`);
    for (const f of (s.pe_firms || [])) allFirmNamesAcrossSectors.add(normalizeName(f.name));
  }
  console.log(`\nTotal unique firms across all sectors: ${allFirmNamesAcrossSectors.size}`);

  // ── Write summary ─────────────────────────────────────────────────────────
  const lines = [
    '═══════════════════════════════════════════════════',
    '  PITCHBOOK IMPORT SUMMARY',
    '═══════════════════════════════════════════════════',
    '',
    `Total rows in PitchBook file:          ${stats.total}`,
    '',
    'ROWS SKIPPED:',
    `  Inactive / not seeking investments:  ${stats.skippedInactive}`,
    `  Filtered investor type:              ${stats.skippedType}`,
    `  No AUM and no investment activity:   ${stats.skippedNoActivity}`,
    '',
    `NEW FIRMS ADDED:                       ${stats.added}`,
    '',
    'Added per sector:',
    ...Object.entries(stats.addedPerSector)
        .sort((a,b) => b[1]-a[1])
        .map(([k,v]) => `  ${k.padEnd(30)} ${v}`),
    '',
    `EXISTING FIRMS UPDATED:                ${stats.updated}`,
    '',
    `FIRMS WITH NO SECTOR ASSIGNED:         ${stats.noSector.length}`,
    ...stats.noSector.map(n => `  - ${n}`),
    '',
    `ERRORS (${stats.errors.length}):`,
    ...stats.errors.map(e => `  ${e}`),
    '',
    '─── FINAL FIRM COUNTS PER SECTOR ───────────────',
    ...reloaded.sectors.map(s => `  ${s.sector_id.padEnd(30)} ${(s.pe_firms||[]).length}`),
    '',
    `Total unique firms across all sectors: ${allFirmNamesAcrossSectors.size}`,
    '',
    `Generated: ${new Date().toISOString()}`,
  ];

  fs.writeFileSync(SUMMARY_OUT, lines.join('\n'), 'utf8');
  console.log('\nSummary written to', SUMMARY_OUT);
  console.log('\nDone.');
  console.log(`  Added:   ${stats.added}`);
  console.log(`  Updated: ${stats.updated}`);
  console.log(`  Skipped: ${stats.skippedInactive + stats.skippedType + stats.skippedNoActivity}`);
  console.log(`  No sector: ${stats.noSector.length}`);
  console.log(`  Errors: ${stats.errors.length}`);
}

main();
