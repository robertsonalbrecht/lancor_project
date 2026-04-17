'use strict';

require('dotenv').config();
const { Pool } = require('pg');

console.log('[db] Initializing pg pool');
console.log('[db] DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');

function describeDatabaseUrl(raw) {
  if (!raw) return { redacted: '(missing)', host: null, port: null, database: null, user: null };
  try {
    const u = new URL(raw);
    const user = u.username || '(none)';
    const host = u.hostname || '(none)';
    const port = u.port || '5432';
    const database = u.pathname ? u.pathname.replace(/^\//, '') : '(none)';
    const redacted = `${u.protocol}//${user}:***@${host}:${port}/${database}`;
    return { redacted, host, port, database, user };
  } catch (e) {
    return { redacted: '(unparseable)', host: null, port: null, database: null, user: null, parseError: e.message };
  }
}

const dbInfo = describeDatabaseUrl(process.env.DATABASE_URL);
console.log('[db] Target:', dbInfo.redacted);
console.log('[db]   host:', dbInfo.host);
console.log('[db]   port:', dbInfo.port);
console.log('[db]   database:', dbInfo.database);
console.log('[db]   user:', dbInfo.user);
if (dbInfo.parseError) console.error('[db]   parse error:', dbInfo.parseError);

// ── DATABASE_URL detailed diagnostics ─────────────────────────────────────
// Goal: figure out why URL parsing fails without leaking the password.
// Enable raw value logging with DEBUG_RAW_DB_URL=true (USE ONCE, THEN REMOVE).

function diagnoseDatabaseUrl(raw) {
  console.log('=== DATABASE_URL DIAGNOSTICS ===');

  if (!raw) {
    console.log('  value: (missing)');
    console.log('================================');
    return;
  }

  console.log('  length:', raw.length);
  console.log('  first 15 chars:', JSON.stringify(raw.slice(0, 15)));
  console.log('  last 10 chars: ', JSON.stringify(raw.slice(-10)));

  // Whitespace / newline at boundaries — a common copy-paste mistake
  if (/^\s/.test(raw))   console.warn('  ⚠  leading whitespace detected');
  if (/\s$/.test(raw))   console.warn('  ⚠  trailing whitespace detected');
  if (/\r|\n/.test(raw)) console.warn('  ⚠  embedded CR/LF detected');

  // Structural char counts — a normal URL should have: 2 ":" in the authority,
  // exactly one "@" separating user:pass from host, and 1+ "/" before the db name.
  const count = (ch) => (raw.split(ch).length - 1);
  console.log('  char counts:',
    `@=${count('@')}`,
    `:=${count(':')}`,
    `/=${count('/')}`,
    `?=${count('?')}`,
    `#=${count('#')}`,
    `%=${count('%')}`);

  // Scan for chars outside the URL-safe set. If the password contains any of
  // these (unencoded), the URL parser will misread the structure.
  const URL_SAFE = /[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/;
  const suspicious = [];
  for (let i = 0; i < raw.length; i++) {
    if (!URL_SAFE.test(raw[i])) {
      suspicious.push({ index: i, char: JSON.stringify(raw[i]), code: raw.charCodeAt(i) });
    }
  }
  if (suspicious.length) {
    console.warn(`  ⚠  ${suspicious.length} non-URL-safe char(s) found (first 10 shown):`);
    suspicious.slice(0, 10).forEach(s =>
      console.warn(`     index ${s.index}: ${s.char} (char code ${s.code})`)
    );
  } else {
    console.log('  no non-URL-safe chars detected');
  }

  // Explicit WHATWG URL parse
  console.log('  --- WHATWG URL.parse ---');
  try {
    const u = new URL(raw);
    console.log('    OK  protocol:', u.protocol, 'host:', u.hostname, 'port:', u.port, 'pathname:', u.pathname, 'hasPassword:', !!u.password);
  } catch (err) {
    console.error('    FAILED:', err.message);
    if (err.code) console.error('    code:', err.code);
    console.error('    stack:', err.stack);
  }

  // pg-connection-string is what pg itself uses to parse the URL.
  // If THIS fails, that's the actual parser blowing up at connection time.
  console.log('  --- pg-connection-string.parse ---');
  try {
    const { parse } = require('pg-connection-string');
    const p = parse(raw);
    console.log('    OK  host:', p.host, 'port:', p.port, 'database:', p.database, 'user:', p.user, 'hasPassword:', !!p.password);
  } catch (err) {
    console.error('    FAILED:', err.message);
    if (err.code) console.error('    code:', err.code);
    if (err.input) console.error('    input (redacted):', String(err.input).replace(/:[^:@/]+@/, ':***@'));
    console.error('    stack:', err.stack);
  }

  // Last-resort raw dump, gated behind an explicit env var. Leaks password.
  if (process.env.DEBUG_RAW_DB_URL === 'true') {
    console.warn('  ⚠  DEBUG_RAW_DB_URL=true — RAW URL (INCLUDES PASSWORD) will be printed');
    console.warn('  ⚠  remove this env var after debugging and rotate the password if logs have been shared');
    console.log('  raw DATABASE_URL:', raw);
  } else {
    console.log('  (set DEBUG_RAW_DB_URL=true for one deploy to print the raw value — leaks the password)');
  }

  console.log('================================');
}

diagnoseDatabaseUrl(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Log idle-client errors (e.g. server dropped connection)
pool.on('error', (err) => {
  console.error('[db] Idle client error:', err.message);
  if (err.code) console.error('[db] Code:', err.code);
});

// Wrap pool.query so every failed query is logged in one place
const _origQuery = pool.query.bind(pool);
pool.query = async function loggedQuery(...args) {
  try {
    return await _origQuery(...args);
  } catch (err) {
    const first = args[0];
    const sql = typeof first === 'string' ? first : (first && first.text) || '<unknown>';
    const snippet = sql.replace(/\s+/g, ' ').trim().slice(0, 300);
    console.error('[db-error] Query failed:', err.message);
    console.error('[db-error] SQL:', snippet);
    if (err.code) console.error('[db-error] Code:', err.code);
    if (err.detail) console.error('[db-error] Detail:', err.detail);
    if (err.hint) console.error('[db-error] Hint:', err.hint);
    throw err;
  }
};

// Boot-time connectivity check (non-blocking)
(async () => {
  console.log('[db] Connection test → attempting:', dbInfo.redacted);
  const t0 = Date.now();
  try {
    const r = await pool.query('SELECT 1 AS ok, current_database() AS db, current_user AS usr, version() AS ver');
    const dur = Date.now() - t0;
    const row = r.rows[0];
    console.log(`[db] Connection OK (${dur}ms)`);
    console.log('[db]   connected to database:', row.db);
    console.log('[db]   connected as user:', row.usr);
    console.log('[db]   server version:', (row.ver || '').split(' ').slice(0, 2).join(' '));
  } catch (err) {
    const dur = Date.now() - t0;
    console.error(`[db] Connection FAILED (${dur}ms) → ${dbInfo.redacted}`);
    console.error('[db]   message:', err.message);
    if (err.code) console.error('[db]   code:', err.code);
    if (err.address) console.error('[db]   address:', err.address);
    if (err.port) console.error('[db]   port:', err.port);
    if (err.errno) console.error('[db]   errno:', err.errno);
    if (err.syscall) console.error('[db]   syscall:', err.syscall);
  }
})();

module.exports = pool;
