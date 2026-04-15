'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const VAULT_PATH = '/Users/robbyalbrecht/Documents/Coding Projects/Obsidian';
const SYNC_STATE_PATH = path.join(__dirname, 'obsidian-sync-state.json');
const SYNC_MODE = process.argv.includes('--sync');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitize(name) {
  // Remove characters Obsidian can't use in filenames
  return (name || 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
}

function wikilink(name) {
  return name ? `[[${sanitize(name)}]]` : '';
}

function frontmatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      v.forEach(item => lines.push(`  - "${String(item).replace(/"/g, '\\"')}"`));
    } else {
      const val = String(v).includes(':') || String(v).includes('#')
        ? `"${String(v).replace(/"/g, '\\"')}"`
        : String(v);
      lines.push(`${k}: ${val}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeNote(folder, filename, content) {
  const filePath = path.join(VAULT_PATH, folder, `${sanitize(filename)}.md`);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function readSyncState() {
  if (!SYNC_MODE) return null;
  try {
    return JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf8'));
  } catch {
    return { last_sync: '1970-01-01T00:00:00Z' };
  }
}

function writeSyncState() {
  fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify({
    last_sync: new Date().toISOString()
  }, null, 2), 'utf8');
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().split('T')[0];
}

// ── Data Fetching ───────────────────────────────────────────────────────────

async function fetchAll(table, syncState) {
  let query = `SELECT * FROM ${table}`;
  const params = [];
  if (syncState) {
    query += ` WHERE updated_at > $1`;
    params.push(syncState.last_sync);
  }
  query += ` ORDER BY created_at`;
  const { rows } = await pool.query(query, params);
  return rows;
}

async function fetchJunction(query, params = []) {
  const { rows } = await pool.query(query, params);
  return rows;
}

// ── Exporters ───────────────────────────────────────────────────────────────

async function exportCandidates(syncState) {
  const candidates = await fetchAll('candidates', syncState);
  if (!candidates.length) return console.log('  Candidates: 0 (no changes)');

  const ids = candidates.map(c => c.id);

  // Fetch related data for these candidates
  const [sectorTags, workHistory, pipelineEntries] = await Promise.all([
    fetchJunction(
      `SELECT cst.candidate_id, s.slug AS sector_slug
       FROM candidate_sector_tags cst JOIN sectors s ON s.id = cst.sector_id
       WHERE cst.candidate_id = ANY($1)`, [ids]
    ),
    fetchJunction(
      `SELECT candidate_id, company_name, title, dates, is_current, company_id
       FROM candidate_work_history WHERE candidate_id = ANY($1) ORDER BY sort_order`, [ids]
    ),
    fetchJunction(
      `SELECT sp.candidate_id, s.slug AS search_slug, sp.stage
       FROM search_pipeline sp JOIN searches s ON s.id = sp.search_id
       WHERE sp.candidate_id = ANY($1)`, [ids]
    )
  ]);

  // Index by candidate_id
  const sectorMap = {};
  sectorTags.forEach(r => (sectorMap[r.candidate_id] ||= []).push(r.sector_slug));
  const historyMap = {};
  workHistory.forEach(r => (historyMap[r.candidate_id] ||= []).push(r));
  const pipelineMap = {};
  pipelineEntries.forEach(r => (pipelineMap[r.candidate_id] ||= []).push(r));

  // Also fetch company names for linking
  const companyIds = [...new Set(workHistory.filter(w => w.company_id).map(w => w.company_id))];
  let companyNameMap = {};
  if (companyIds.length) {
    const { rows } = await pool.query(
      `SELECT id, name FROM companies WHERE id = ANY($1)`, [companyIds]
    );
    rows.forEach(r => companyNameMap[r.id] = r.name);
  }

  for (const c of candidates) {
    const sectors = sectorMap[c.id] || [];
    const history = historyMap[c.id] || [];
    const searches = pipelineMap[c.id] || [];

    const fm = frontmatter({
      type: 'candidate',
      slug: c.slug,
      current_title: c.current_title,
      current_firm: c.current_firm,
      location: c.home_location,
      archetype: c.archetype,
      quality_rating: c.quality_rating,
      availability: c.availability,
      linkedin: c.linkedin_url,
      date_added: formatDate(c.date_added),
      updated_at: formatDate(c.updated_at),
      sectors: sectors
    });

    const lines = [fm, ''];

    // Current firm link
    if (c.current_firm) {
      lines.push(`**Current Firm:** ${wikilink(c.current_firm)}`);
      lines.push('');
    }

    // Searches this candidate appears in
    if (searches.length) {
      lines.push('## Searches');
      for (const s of searches) {
        lines.push(`- ${wikilink(s.search_slug)} — Stage: ${s.stage || 'Unknown'}`);
      }
      lines.push('');
    }

    // Work history with wikilinks to companies
    if (history.length) {
      lines.push('## Work History');
      for (const h of history) {
        const companyLink = h.company_id && companyNameMap[h.company_id]
          ? wikilink(companyNameMap[h.company_id])
          : h.company_name || '';
        const current = h.is_current ? ' *(current)*' : '';
        lines.push(`- **${h.title || 'Unknown Title'}** at ${companyLink}${current} ${h.dates || ''}`);
      }
      lines.push('');
    }

    // Sector tags
    if (sectors.length) {
      lines.push('## Sectors');
      lines.push(sectors.map(s => wikilink(s)).join(' · '));
      lines.push('');
    }

    // Notes
    if (c.notes) {
      lines.push('## Notes');
      lines.push(c.notes);
      lines.push('');
    }

    writeNote('Candidates', c.name || c.slug, lines.join('\n'));
  }

  console.log(`  Candidates: ${candidates.length}`);
}

async function exportCompanies(syncState) {
  const companies = await fetchAll('companies', syncState);
  if (!companies.length) return console.log('  Companies: 0 (no changes)');

  const ids = companies.map(c => c.id);

  const sectorTags = await fetchJunction(
    `SELECT cst.company_id, s.slug AS sector_slug, cst.is_specialist
     FROM company_sector_tags cst JOIN sectors s ON s.id = cst.sector_id
     WHERE cst.company_id = ANY($1)`, [ids]
  );

  const sectorMap = {};
  sectorTags.forEach(r => {
    (sectorMap[r.company_id] ||= []).push({
      sector: r.sector_slug,
      specialist: r.is_specialist
    });
  });

  for (const co of companies) {
    const sectors = sectorMap[co.id] || [];

    const fm = frontmatter({
      type: 'company',
      slug: co.slug,
      company_type: co.company_type,
      hq: co.hq,
      size_tier: co.size_tier,
      strategy: co.strategy,
      entity_type: co.entity_type,
      ownership_status: co.ownership_status,
      aum_tier: co.size_tier,
      industry: co.industry,
      employee_count: co.employee_count,
      website: co.website_url,
      linkedin: co.linkedin_company_url,
      updated_at: formatDate(co.updated_at)
    });

    const lines = [fm, ''];

    if (co.description) {
      lines.push(co.description);
      lines.push('');
    }

    // Sector tags with specialist flag
    if (sectors.length) {
      lines.push('## Sectors');
      for (const s of sectors) {
        const specialist = s.specialist ? ' *(specialist)*' : '';
        lines.push(`- ${wikilink(s.sector)}${specialist}`);
      }
      lines.push('');
    }

    // PE-specific fields
    if (co.company_type === 'pe_firm' || co.entity_type) {
      lines.push('## Investment Profile');
      if (co.investment_professionals) lines.push(`- **Investment Professionals:** ${co.investment_professionals}`);
      if (co.preferred_ebitda_min || co.preferred_ebitda_max) {
        lines.push(`- **Preferred EBITDA:** $${co.preferred_ebitda_min || '?'}M – $${co.preferred_ebitda_max || '?'}M`);
      }
      if (co.preferred_geometry) lines.push(`- **Preferred Geography:** ${co.preferred_geometry}`);
      if (co.last_fund_name) lines.push(`- **Last Fund:** ${co.last_fund_name} ($${co.last_fund_size || '?'}M, ${co.last_fund_vintage || '?'})`);
      if (co.dry_powder) lines.push(`- **Dry Powder:** $${co.dry_powder}M`);
      if (co.active_portfolio_count) lines.push(`- **Active Portfolio:** ${co.active_portfolio_count}`);
      if (co.investments_last_2yr) lines.push(`- **Investments (2yr):** ${co.investments_last_2yr}`);
      if (co.last_investment_date) lines.push(`- **Last Investment:** ${formatDate(co.last_investment_date)}`);
      lines.push('');
    }

    if (co.notes) {
      lines.push('## Notes');
      lines.push(co.notes);
      lines.push('');
    }

    writeNote('Companies', co.name || co.slug, lines.join('\n'));
  }

  console.log(`  Companies: ${companies.length}`);
}

async function exportSearches(syncState) {
  const searches = await fetchAll('searches', syncState);
  if (!searches.length) return console.log('  Searches: 0 (no changes)');

  const ids = searches.map(s => s.id);

  const [pipelineRows, sectorRows, teamRows, contactRows] = await Promise.all([
    fetchJunction(
      `SELECT sp.search_id, sp.name, sp.current_title, sp.current_firm, sp.stage,
              sp.lancor_assessment, sp.source, c.slug AS candidate_slug, c.name AS candidate_name
       FROM search_pipeline sp
       LEFT JOIN candidates c ON c.id = sp.candidate_id
       WHERE sp.search_id = ANY($1) ORDER BY sp.stage, sp.name`, [ids]
    ),
    fetchJunction(
      `SELECT ss.search_id, s.slug AS sector_slug
       FROM search_sectors ss JOIN sectors s ON s.id = ss.sector_id
       WHERE ss.search_id = ANY($1)`, [ids]
    ),
    fetchJunction(
      `SELECT search_id, initials, role FROM search_lancor_team WHERE search_id = ANY($1)`, [ids]
    ),
    fetchJunction(
      `SELECT search_id, name, abbreviation FROM search_client_contacts WHERE search_id = ANY($1)`, [ids]
    )
  ]);

  // Index
  const pipelineMap = {};
  pipelineRows.forEach(r => (pipelineMap[r.search_id] ||= []).push(r));
  const sectorMap = {};
  sectorRows.forEach(r => (sectorMap[r.search_id] ||= []).push(r.sector_slug));
  const teamMap = {};
  teamRows.forEach(r => (teamMap[r.search_id] ||= []).push(r));
  const contactMap = {};
  contactRows.forEach(r => (contactMap[r.search_id] ||= []).push(r));

  for (const s of searches) {
    const pipeline = pipelineMap[s.id] || [];
    const sectors = sectorMap[s.id] || [];
    const team = teamMap[s.id] || [];
    const contacts = contactMap[s.id] || [];

    const fm = frontmatter({
      type: 'search',
      slug: s.slug,
      status: s.status,
      client_name: s.client_name,
      role_title: s.role_title,
      lead_recruiter: s.lead_recruiter,
      date_opened: formatDate(s.date_opened),
      date_closed: formatDate(s.date_closed),
      archetypes: s.archetypes_requested,
      sectors: sectors,
      updated_at: formatDate(s.updated_at)
    });

    const lines = [fm, ''];

    // Client link
    if (s.client_name) {
      lines.push(`**Client:** ${wikilink(s.client_name)}`);
      lines.push('');
    }

    // Archetypes
    if (s.archetypes_requested && s.archetypes_requested.length) {
      lines.push(`**Target Archetypes:** ${s.archetypes_requested.join(', ')}`);
      lines.push('');
    }

    // Ideal candidate profile
    if (s.ideal_candidate_profile) {
      lines.push('## Ideal Candidate Profile');
      lines.push(s.ideal_candidate_profile);
      lines.push('');
    }

    // Lancor team
    if (team.length) {
      lines.push('## Lancor Team');
      for (const t of team) {
        lines.push(`- ${t.initials} (${t.role || 'team'})`);
      }
      lines.push('');
    }

    // Client contacts
    if (contacts.length) {
      lines.push('## Client Contacts');
      for (const c of contacts) {
        lines.push(`- ${c.name}${c.abbreviation ? ` (${c.abbreviation})` : ''}`);
      }
      lines.push('');
    }

    // Pipeline by stage
    if (pipeline.length) {
      lines.push('## Pipeline');
      const byStage = {};
      pipeline.forEach(p => (byStage[p.stage || 'Unassigned'] ||= []).push(p));

      for (const [stage, candidates] of Object.entries(byStage)) {
        lines.push(`### ${stage}`);
        for (const p of candidates) {
          const link = p.candidate_name ? wikilink(p.candidate_name) : p.name || 'Unknown';
          const firm = p.current_firm ? ` at ${wikilink(p.current_firm)}` : '';
          const assess = p.lancor_assessment ? ` — ${p.lancor_assessment}` : '';
          lines.push(`- ${link}${firm}${assess}`);
        }
        lines.push('');
      }
    }

    // Sector links
    if (sectors.length) {
      lines.push('## Sectors');
      lines.push(sectors.map(s => wikilink(s)).join(' · '));
      lines.push('');
    }

    writeNote('Searches', s.slug || s.client_name, lines.join('\n'));
  }

  console.log(`  Searches: ${searches.length}`);
}

async function exportPlaybooks(syncState) {
  const sectors = await fetchAll('sectors', syncState);
  if (!sectors.length) return console.log('  Playbooks: 0 (no changes)');

  const ids = sectors.map(s => s.id);

  const [peFirms, targetCompanies] = await Promise.all([
    fetchJunction(
      `SELECT spf.sector_id, spf.name, co.name AS company_name, co.slug AS company_slug,
              spf.hq, spf.size_tier, spf.strategy, spf.sector_focus
       FROM sector_pe_firms spf
       JOIN companies co ON co.id = spf.company_id
       WHERE spf.sector_id = ANY($1) ORDER BY spf.name`, [ids]
    ),
    fetchJunction(
      `SELECT stc.sector_id, stc.name, co.name AS company_name, co.slug AS company_slug,
              stc.hq, stc.why_target
       FROM sector_target_companies stc
       JOIN companies co ON co.id = stc.company_id
       WHERE stc.sector_id = ANY($1) ORDER BY stc.name`, [ids]
    )
  ]);

  const peMap = {};
  peFirms.forEach(r => (peMap[r.sector_id] ||= []).push(r));
  const targetMap = {};
  targetCompanies.forEach(r => (targetMap[r.sector_id] ||= []).push(r));

  for (const s of sectors) {
    const pe = peMap[s.id] || [];
    const targets = targetMap[s.id] || [];

    const fm = frontmatter({
      type: 'playbook',
      slug: s.slug,
      sector_name: s.sector_name,
      build_status: s.build_status,
      last_updated: formatDate(s.last_updated),
      updated_at: formatDate(s.updated_at)
    });

    const lines = [fm, ''];
    lines.push(`# ${s.sector_name || s.slug}`);
    lines.push('');

    if (pe.length) {
      lines.push('## PE Firms');
      for (const f of pe) {
        const link = wikilink(f.company_name || f.name);
        const meta = [f.size_tier, f.strategy, f.hq].filter(Boolean).join(' · ');
        lines.push(`- ${link}${meta ? ` — ${meta}` : ''}`);
      }
      lines.push('');
    }

    if (targets.length) {
      lines.push('## Target Companies');
      for (const t of targets) {
        const link = wikilink(t.company_name || t.name);
        lines.push(`- ${link}${t.why_target ? ` — ${t.why_target}` : ''}`);
      }
      lines.push('');
    }

    writeNote('Playbooks', s.sector_name || s.slug, lines.join('\n'));
  }

  console.log(`  Playbooks: ${sectors.length}`);
}

async function exportRoster(syncState) {
  // Get all firms that have roster entries
  let rosterQuery = `
    SELECT fr.*, co.name AS firm_name, co.slug AS firm_slug,
           c.name AS candidate_name, c.slug AS candidate_slug
    FROM firm_roster fr
    JOIN companies co ON co.id = fr.company_id
    LEFT JOIN candidates c ON c.id = fr.candidate_id
  `;
  const params = [];
  if (syncState) {
    rosterQuery += ` WHERE fr.updated_at > $1`;
    params.push(syncState.last_sync);
  }
  rosterQuery += ` ORDER BY co.name, fr.name`;

  const { rows: roster } = await pool.query(rosterQuery, params);
  if (!roster.length) return console.log('  Roster: 0 (no changes)');

  // Group by firm
  const byFirm = {};
  for (const r of roster) {
    const key = r.firm_slug || r.company_id;
    if (!byFirm[key]) {
      byFirm[key] = { name: r.firm_name, slug: r.firm_slug, people: [] };
    }
    byFirm[key].people.push(r);
  }

  for (const [, firm] of Object.entries(byFirm)) {
    const fm = frontmatter({
      type: 'roster',
      firm: firm.name,
      firm_slug: firm.slug,
      headcount: firm.people.length
    });

    const lines = [fm, ''];
    lines.push(`# ${wikilink(firm.name)} — Roster`);
    lines.push('');

    // Group by status
    const byStatus = {};
    firm.people.forEach(p => (byStatus[p.roster_status || 'Unknown'] ||= []).push(p));

    for (const [status, people] of Object.entries(byStatus)) {
      lines.push(`## ${status}`);
      for (const p of people) {
        const nameLink = p.candidate_name ? wikilink(p.candidate_name) : p.name;
        const title = p.title ? ` — ${p.title}` : '';
        const location = p.location ? ` (${p.location})` : '';
        lines.push(`- ${nameLink}${title}${location}`);
      }
      lines.push('');
    }

    writeNote('Roster', `${firm.name} Roster`, lines.join('\n'));
  }

  console.log(`  Roster: ${Object.keys(byFirm).length} firms, ${roster.length} people`);
}

async function exportTemplates(syncState) {
  const templates = await fetchAll('outreach_messages', syncState);
  const searchTemplates = await fetchAll('search_templates', syncState);
  const all = [...templates, ...searchTemplates];
  if (!all.length) return console.log('  Templates: 0 (no changes)');

  for (const t of templates) {
    const fm = frontmatter({
      type: 'outreach_template',
      slug: t.slug,
      archetype: t.archetype,
      channel: t.channel
    });
    const lines = [fm, ''];
    if (t.subject) lines.push(`**Subject:** ${t.subject}`, '');
    if (t.body) lines.push(t.body, '');
    if (t.notes) lines.push('## Notes', t.notes, '');
    writeNote('Templates', t.name || t.slug, lines.join('\n'));
  }

  for (const t of searchTemplates) {
    const fm = frontmatter({
      type: 'search_template',
      slug: t.slug,
      template_type: t.template_type
    });
    const lines = [fm, ''];
    if (t.content) lines.push(t.content, '');
    if (t.notes) lines.push('## Notes', t.notes, '');
    writeNote('Templates', t.name || t.slug, lines.join('\n'));
  }

  console.log(`  Templates: ${all.length}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const syncState = readSyncState();

  if (SYNC_MODE) {
    console.log(`Obsidian sync (incremental since ${syncState.last_sync})`);
  } else {
    console.log('Obsidian full export — overwriting vault...');
    // Clear existing folders for full export
    for (const folder of ['Candidates', 'Companies', 'Searches', 'Playbooks', 'Roster', 'Templates']) {
      const dir = path.join(VAULT_PATH, folder);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    }
  }

  console.log(`Output: ${VAULT_PATH}\n`);

  await exportCandidates(syncState);
  await exportCompanies(syncState);
  await exportSearches(syncState);
  await exportPlaybooks(syncState);
  await exportRoster(syncState);
  await exportTemplates(syncState);

  writeSyncState();
  console.log('\nDone. Sync state saved.');
  await pool.end();
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
