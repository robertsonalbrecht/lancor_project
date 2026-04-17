'use strict';

require('dotenv').config();
const { Pool } = require('pg');

console.log('[db] Initializing pg pool');
console.log('[db] DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');

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
pool.query('SELECT 1 AS ok').then((r) => {
  console.log('[db] Connection OK (SELECT 1 →', r.rows[0].ok + ')');
}).catch((err) => {
  console.error('[db] Connection FAILED:', err.message);
  if (err.code) console.error('[db] Code:', err.code);
});

module.exports = pool;
