'use strict';

/**
 * enrich_companies.js
 *
 * Enriches company stubs in the company pool using Anthropic's API with
 * web search. Fills in: company_type, website_url, hq, year_founded,
 * industry, employee_count, revenue_tier, ownership_type, ticker,
 * parent_company, description.
 *
 * Usage:
 *   node scripts/enrich_companies.js --limit 50
 *   node scripts/enrich_companies.js --limit 10 --retry-failed
 *   node scripts/enrich_companies.js --dry-run --limit 5
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');

const companyPoolPath  = path.join(__dirname, '../data/company_pool.json');
const progressPath     = path.join(__dirname, '../data/enrichment_progress.json');

// ── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 50;
const retryFailed = args.includes('--retry-failed');
const dryRun = args.includes('--dry-run');

const DELAY_MS = 2000; // delay between API calls
const MAX_RETRIES = 3;

// ── Anthropic client ─────────────────────────────────────────────────────────

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

// ── Enrichment prompt ────────────────────────────────────────────────────────

function buildPrompt(company) {
  const nameInfo = company.name;
  const aliasInfo = (company.aliases || []).length > 0
    ? ` (also known as: ${company.aliases.join(', ')})`
    : '';
  const linkedinInfo = company.linkedin_company_url
    ? ` Their LinkedIn page is: ${company.linkedin_company_url}`
    : '';

  return `Research the company "${nameInfo}"${aliasInfo}.${linkedinInfo}

I need you to find factual information about this company and return ONLY valid JSON (no markdown, no explanation) with this exact structure:

{
  "company_type": "one of: Portfolio Company, Public Company, Private Company, Consulting Firm, Investment Bank, Accounting Firm, Law Firm, Government / Military, Nonprofit / Education, PE Firm, Other",
  "website_url": "https://example.com or null if not found",
  "hq": "City, State or City, Country",
  "year_founded": 1990,
  "industry": "e.g. Industrial Manufacturing, Enterprise Software, Healthcare Services, Management Consulting",
  "employee_count": 5000,
  "revenue_tier": "one of: <$10M, $10M-$50M, $50M-$200M, $200M-$500M, $500M-$1B, $1B+, or null if unknown",
  "ownership_type": "one of: Public, Private, PE-backed, VC-backed, Government, Nonprofit, or null if unknown",
  "ticker": "TICK or null if not public",
  "parent_company": "Parent Company Name or null if independent",
  "description": "1-2 sentence description of what the company does"
}

If the company no longer exists (was acquired, dissolved, etc.), still provide what information you can and note the acquisition in the description. If you cannot determine a field, use null. Return ONLY the JSON object.`;
}

// ── Parse enrichment response ────────────────────────────────────────────────

function parseEnrichmentResponse(response) {
  // Extract text from the response
  let text = '';
  for (const block of response.content || []) {
    if (block.type === 'text') text += block.text;
  }

  // Find JSON in the response
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[0]);
    // Validate and clean fields
    const validTypes = ['Portfolio Company', 'Public Company', 'Private Company', 'Consulting Firm',
      'Investment Bank', 'Accounting Firm', 'Law Firm', 'Government / Military',
      'Nonprofit / Education', 'PE Firm', 'Other'];
    const validRevTiers = ['<$10M', '$10M-$50M', '$50M-$200M', '$200M-$500M', '$500M-$1B', '$1B+'];
    const validOwnership = ['Public', 'Private', 'PE-backed', 'VC-backed', 'Government', 'Nonprofit'];

    return {
      company_type:   validTypes.includes(data.company_type) ? data.company_type : (data.company_type || null),
      website_url:    typeof data.website_url === 'string' ? data.website_url : null,
      hq:             typeof data.hq === 'string' ? data.hq : null,
      year_founded:   typeof data.year_founded === 'number' ? data.year_founded : null,
      industry:       typeof data.industry === 'string' ? data.industry : null,
      employee_count: typeof data.employee_count === 'number' ? data.employee_count : null,
      revenue_tier:   validRevTiers.includes(data.revenue_tier) ? data.revenue_tier : null,
      ownership_type: validOwnership.includes(data.ownership_type) ? data.ownership_type : null,
      ticker:         typeof data.ticker === 'string' && data.ticker.length <= 6 ? data.ticker : null,
      parent_company: typeof data.parent_company === 'string' ? data.parent_company : null,
      description:    typeof data.description === 'string' ? data.description : null
    };
  } catch (e) {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Enrich Companies Script`);
  console.log(`  Limit: ${limit} | Retry failed: ${retryFailed} | Dry run: ${dryRun}`);
  console.log('');

  const companyData = JSON.parse(fs.readFileSync(companyPoolPath, 'utf8'));
  const companies = companyData.companies || [];

  // Load progress
  let progress = { processed_ids: [], failed_ids: [] };
  if (fs.existsSync(progressPath)) {
    try { progress = JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch {}
  }
  const processedSet = new Set(progress.processed_ids || []);

  // Filter to pending companies
  const pending = companies.filter(c => {
    if (processedSet.has(c.company_id)) return false;
    if (c.enrichment_status === 'enriched') return false;
    if (c.enrichment_status === 'skipped') return false;
    if (c.enrichment_status === 'failed' && !retryFailed) return false;
    return true;
  });

  console.log(`  ${pending.length} companies pending enrichment`);
  const batch = pending.slice(0, limit);
  console.log(`  Processing ${batch.length} companies this run`);
  console.log('');

  if (batch.length === 0) {
    console.log('Nothing to enrich. Done!');
    return;
  }

  if (dryRun) {
    console.log('[DRY RUN] Would enrich:');
    batch.forEach(c => console.log(`  - ${c.name} (${c.company_id})`));
    return;
  }

  const client = getClient();
  let enrichedCount = 0;
  let failedCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < batch.length; i++) {
    const company = batch[i];
    const idx = companies.findIndex(c => c.company_id === company.company_id);
    if (idx === -1) continue;

    console.log(`[${i + 1}/${batch.length}] Enriching: ${company.name}...`);

    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
          messages: [{ role: 'user', content: buildPrompt(company) }]
        });

        const enriched = parseEnrichmentResponse(response);
        if (enriched) {
          // Merge enriched fields (only fill nulls, don't overwrite existing data)
          Object.entries(enriched).forEach(([key, value]) => {
            if (value !== null && (companies[idx][key] === null || companies[idx][key] === undefined || companies[idx][key] === '')) {
              companies[idx][key] = value;
            }
          });
          companies[idx].enrichment_status = 'enriched';
          companies[idx].last_updated = today;
          enrichedCount++;
          success = true;

          console.log(`  ✓ ${enriched.company_type || '?'} | ${enriched.hq || '?'} | ${enriched.industry || '?'}`);
        } else {
          console.log(`  ✗ Could not parse response (attempt ${attempt}/${MAX_RETRIES})`);
          if (attempt < MAX_RETRIES) await sleep(DELAY_MS * attempt);
        }

        if (success) break;
      } catch (err) {
        const isRateLimit = err.status === 429;
        const waitMs = isRateLimit ? DELAY_MS * Math.pow(2, attempt) : DELAY_MS * attempt;
        console.log(`  ✗ Error: ${err.message} (attempt ${attempt}/${MAX_RETRIES}, waiting ${waitMs}ms)`);
        await sleep(waitMs);
      }
    }

    if (!success) {
      companies[idx].enrichment_status = 'failed';
      companies[idx].last_updated = today;
      failedCount++;
      progress.failed_ids = progress.failed_ids || [];
      if (!progress.failed_ids.includes(company.company_id)) {
        progress.failed_ids.push(company.company_id);
      }
    }

    // Track progress
    processedSet.add(company.company_id);
    progress.processed_ids = [...processedSet];

    // Checkpoint every 10 companies
    if ((i + 1) % 10 === 0 || i === batch.length - 1) {
      fs.writeFileSync(companyPoolPath, JSON.stringify({ companies }, null, 2), 'utf8');
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');
      console.log(`  [checkpoint] Saved progress (${i + 1}/${batch.length})`);
    }

    // Rate limit delay
    if (i < batch.length - 1) await sleep(DELAY_MS);
  }

  // Final write
  fs.writeFileSync(companyPoolPath, JSON.stringify({ companies }, null, 2), 'utf8');
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');

  console.log(`\nDone!`);
  console.log(`  Enriched: ${enrichedCount}`);
  console.log(`  Failed: ${failedCount}`);
  console.log(`  Total processed this session: ${batch.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
