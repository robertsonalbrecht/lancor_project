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
  'candidate_pool.json':  { "candidates": [] },
  'company_pool.json':    { "companies": [] },
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

const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { requireAuth } = require('./middleware/auth');

app.use(helmet({
  // CSP is disabled because the existing SPA uses inline onclick handlers.
  // Revisit once the client is refactored to use addEventListener.
  contentSecurityPolicy: false
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// Serve the login page before the static middleware so /login always resolves.
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'login.html'));
});

app.use(express.static(path.join(__dirname, '..', 'client')));

// Request logger for /api/* — logs method, path, status, duration
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const dur = Date.now() - start;
    const tag = res.statusCode >= 500 ? '[api-err]' : '[api]';
    console.log(`${tag} ${req.method} ${req.originalUrl} → ${res.statusCode} (${dur}ms)`);
  });
  next();
});

// ── Public API (no auth required) ──────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json({
    aiFeaturesEnabled: process.env.ENABLE_AI_FEATURES !== 'false'
  });
});

const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);

// ── Auth lockdown: everything under /api below this line requires a session
// (or, for /api/candidates/prefill, a valid X-API-Token header) ─────────────

app.use('/api', requireAuth);

// ── Protected API Routes ───────────────────────────────────────────────────

const playbooksRouter  = require('./routes/playbooks');
const searchesRouter   = require('./routes/searches');
const candidatesRouter = require('./routes/candidates');
const templatesRouter  = require('./routes/templates');
const companiesRouter  = require('./routes/companies');
const aiSearchRouter   = require('./routes/ai-search');
const analyticsRouter  = require('./routes/analytics');

app.use('/api/playbooks',  playbooksRouter);
app.use('/api/searches',   searchesRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/templates',  templatesRouter);
app.use('/api/companies',  companiesRouter);
app.use('/api/ai-search',  aiSearchRouter);
app.use('/api/analytics',  analyticsRouter);

// ── Stats endpoint (used by home dashboard) ────────────────────────────────

app.get('/api/stats', async (req, res) => {
  console.log('=== API Endpoint Debug ===');
  console.log('Endpoint:', req.path);
  console.log('Method:', req.method);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
  console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING');
  console.log('VOYAGE_API_KEY:', process.env.VOYAGE_API_KEY ? 'SET' : 'MISSING');
  console.log('ENABLE_AI_FEATURES:', process.env.ENABLE_AI_FEATURES || '(unset)');

  try {
    const db = require('./db');
    console.log('[/api/stats] Running 5 COUNT queries in parallel...');
    const [searches, candidates, companies, playbooks, templates] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS cnt FROM searches WHERE status IN ('active', 'open')"),
      db.query('SELECT COUNT(*)::int AS cnt FROM candidates'),
      db.query('SELECT COUNT(*)::int AS cnt FROM companies'),
      db.query("SELECT COUNT(*)::int AS cnt FROM sectors WHERE build_status != 'pending'"),
      db.query('SELECT (SELECT COUNT(*) FROM outreach_messages) + (SELECT COUNT(*) FROM search_templates) AS cnt')
    ]);
    const payload = {
      activeSearches: searches.rows[0].cnt,
      totalCandidates: candidates.rows[0].cnt,
      totalCompanies: companies.rows[0].cnt,
      playbooksBuilt: playbooks.rows[0].cnt,
      totalTemplates: parseInt(templates.rows[0].cnt)
    };
    console.log('[/api/stats] Database queries successful:', payload);
    res.json(payload);
  } catch (err) {
    console.error('[/api/stats] Database query failed:', err.message);
    if (err.code) console.error('[/api/stats] Code:', err.code);
    if (err.detail) console.error('[/api/stats] Detail:', err.detail);
    console.error('[/api/stats] Full error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all: serve SPA ───────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ── Express error handler (final fallback) ─────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[express-error]', req.method, req.originalUrl, '→', err.message);
  if (err.code) console.error('[express-error] Code:', err.code);
  console.error(err.stack);
  if (!res.headersSent) res.status(500).json({ error: err.message });
});

// ── Start ──────────────────────────────────────────────────────────────────

function logBootConfig() {
  console.log('=== Lancor Search OS Boot ===');
  console.log('NODE_ENV:', process.env.NODE_ENV || '(unset)');
  console.log('PORT:', PORT);
  console.log('DATA_PATH:', DATA_PATH);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
  console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING');
  console.log('VOYAGE_API_KEY:', process.env.VOYAGE_API_KEY ? 'SET' : 'MISSING');
  console.log('ENABLE_AI_FEATURES:', process.env.ENABLE_AI_FEATURES || '(unset, default enabled)');
  console.log('=============================');
}

logBootConfig();
ensureDataFiles();

app.listen(PORT, () => {
  console.log(`Lancor Search OS running at http://localhost:${PORT}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandled-rejection]', reason && reason.message ? reason.message : reason);
  if (reason && reason.stack) console.error(reason.stack);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaught-exception]', err.message);
  console.error(err.stack);
});
