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
