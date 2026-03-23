'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');

// ── Ensure data directory and JSON files exist on startup ──────────────────

const DATA_FILES = {
  'sector_playbooks.json': {
    "sectors": [
      { "sector_id": "industrials", "sector_name": "Industrials", "build_status": "partial", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "technology-software", "sector_name": "Technology / Software", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "tech-enabled-services", "sector_name": "Tech-Enabled Services", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "healthcare", "sector_name": "Healthcare", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "financial-services", "sector_name": "Financial Services", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "consumer", "sector_name": "Consumer", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "business-services", "sector_name": "Business Services", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "infrastructure-energy", "sector_name": "Infrastructure / Energy", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "life-sciences", "sector_name": "Life Sciences", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "media-entertainment", "sector_name": "Media / Entertainment", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "real-estate-proptech", "sector_name": "Real Estate / PropTech", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] },
      { "sector_id": "agriculture-fb", "sector_name": "Agriculture / Food & Beverage", "build_status": "pending", "last_updated": "2026-03-22", "pe_firms": [], "target_companies": [], "allstar_pool": [] }
    ]
  },
  'active_searches.json': {
    "searches": [
      {
        "search_id": "berkshire-industrials-2026",
        "client_name": "Berkshire Partners",
        "role_title": "Industrials Operating Partner",
        "sectors": ["industrials"],
        "date_opened": "2026-02-01",
        "date_closed": null,
        "status": "active",
        "lead_recruiter": "Robby Albrecht",
        "ideal_candidate_profile": "",
        "archetypes_requested": ["PE Lateral", "Industry Operator"],
        "client_contacts": [
          { "name": "Marni", "title": "", "display_in_matrix": true },
          { "name": "Ted", "title": "", "display_in_matrix": true },
          { "name": "Blake", "title": "", "display_in_matrix": true },
          { "name": "Sam A", "title": "", "display_in_matrix": true },
          { "name": "EJ", "title": "", "display_in_matrix": true }
        ],
        "lancor_team": [
          { "initials": "CC", "full_name": "Chris Conti", "role": "Partner" },
          { "initials": "SM", "full_name": "Shannon Mace", "role": "Consultant" },
          { "initials": "RA", "full_name": "Robby Albrecht", "role": "Partner" },
          { "initials": "KC", "full_name": "Kelli Colacarro", "role": "Consultant" },
          { "initials": "BD", "full_name": "Brett Dubin", "role": "Consultant" },
          { "initials": "TO", "full_name": "Tim OToole", "role": "Consultant" },
          { "initials": "TH", "full_name": "Trever Helwig", "role": "Consultant" }
        ],
        "pipeline": [],
        "sourcing_coverage": {
          "pe_firms": [],
          "companies": []
        },
        "weekly_updates": []
      }
    ]
  },
  'candidate_pool.json': { "candidates": [] },
  'search_templates.json': {
    "templates": {
      "boolean_strings": [],
      "pitchbook_params": [],
      "outreach_messages": [],
      "ideal_candidate_profiles": [],
      "screen_question_guides": []
    }
  }
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
    console.log(`Created data directory: ${DATA_PATH}`);
  }

  for (const [filename, defaultData] of Object.entries(DATA_FILES)) {
    const filePath = path.join(DATA_PATH, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
      console.log(`Created data file: ${filename}`);
    }
  }

  // Ensure archive subdirectory exists
  const archivePath = path.join(DATA_PATH, 'archive', 'closed_searches');
  if (!fs.existsSync(archivePath)) {
    fs.mkdirSync(archivePath, { recursive: true });
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// ── API Routes ─────────────────────────────────────────────────────────────

const playbooksRouter = require('./routes/playbooks');
const searchesRouter  = require('./routes/searches');
const candidatesRouter = require('./routes/candidates');
const templatesRouter  = require('./routes/templates');

app.use('/api/playbooks',  playbooksRouter);
app.use('/api/searches',   searchesRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/templates',  templatesRouter);

// ── Stats endpoint (used by home dashboard) ────────────────────────────────

app.get('/api/stats', (req, res) => {
  try {
    const searches  = JSON.parse(fs.readFileSync(path.join(DATA_PATH, 'active_searches.json'), 'utf8'));
    const pool      = JSON.parse(fs.readFileSync(path.join(DATA_PATH, 'candidate_pool.json'), 'utf8'));
    const playbooks = JSON.parse(fs.readFileSync(path.join(DATA_PATH, 'sector_playbooks.json'), 'utf8'));
    const templates = JSON.parse(fs.readFileSync(path.join(DATA_PATH, 'search_templates.json'), 'utf8'));

    const activeSearches   = searches.searches.filter(s => s.status === 'active').length;
    const totalCandidates  = pool.candidates.length;
    const playbooksBuilt   = playbooks.sectors.filter(s => s.build_status !== 'pending').length;
    const t = templates.templates;
    const totalTemplates   = (t.boolean_strings.length + t.pitchbook_params.length +
                               t.outreach_messages.length + t.ideal_candidate_profiles.length +
                               t.screen_question_guides.length);

    res.json({ activeSearches, totalCandidates, playbooksBuilt, totalTemplates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all: serve SPA ───────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────

ensureDataFiles();

app.listen(PORT, () => {
  console.log(`Lancor Search OS running at http://localhost:${PORT}`);
});
