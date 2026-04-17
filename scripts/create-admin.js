'use strict';

// Interactive script to create the first admin user and backfill existing
// searches' created_by to that admin. Safe to re-run: it detects an existing
// admin and asks whether to create another user or update the password of the
// existing one. Does NOT touch runtime app behavior.
//
// Usage:  npm run create-admin
// Or:     node scripts/create-admin.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline = require('readline');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    if (!silent) {
      rl.question(question, (answer) => resolve(answer.trim()));
      return;
    }
    // Silent (password) input — suppress echo by overriding output writes
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      ch = ch.toString('utf8');
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode && stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(buf);
      } else if (ch === '\u0003') { // Ctrl-C
        process.exit(1);
      } else if (ch === '\u007f' || ch === '\b') { // backspace
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function validPassword(s) {
  // Minimum complexity: 12+ chars, at least one lower, one upper, one digit.
  if (s.length < 12) return 'must be at least 12 characters';
  if (!/[a-z]/.test(s)) return 'must contain a lowercase letter';
  if (!/[A-Z]/.test(s)) return 'must contain an uppercase letter';
  if (!/[0-9]/.test(s)) return 'must contain a digit';
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set in .env');
    process.exit(1);
  }

  // Show which DB we're connected to, so a mismatched .env is obvious.
  try {
    const u = new URL(process.env.DATABASE_URL);
    console.log(`Connected target: ${u.hostname}:${u.port || '5432'} db=${(u.pathname || '').replace(/^\//, '') || '(none)'} user=${u.username || '(none)'}`);
  } catch (_) {
    console.log('Connected target: (unparseable DATABASE_URL)');
  }

  console.log('=== Create Admin User ===');
  console.log('This will create an admin user and (on first run) backfill all');
  console.log('existing searches to be owned by this user.\n');

  // Make sure the auth tables exist
  const { rows: check } = await pool.query(`
    SELECT to_regclass('public.users') AS users,
           to_regclass('public.user_sessions') AS sessions,
           to_regclass('public.search_user_access') AS access
  `);
  const missing = Object.entries(check[0]).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`ERROR: Missing table(s): ${missing.join(', ')}`);
    console.error('Run migration 011_auth_tables.sql first.');
    process.exit(1);
  }

  // Collect inputs
  let email;
  while (true) {
    email = (await ask('Email: ')).toLowerCase();
    if (validEmail(email)) break;
    console.log('  → not a valid email, try again');
  }

  const firstName = await ask('First name: ');
  const lastName = await ask('Last name: ');

  let password;
  while (true) {
    password = await ask('Password (12+ chars, mixed case, digit): ', { silent: true });
    const err = validPassword(password);
    if (err) { console.log(`  → ${err}`); continue; }
    const confirm = await ask('Confirm password: ', { silent: true });
    if (confirm !== password) { console.log('  → passwords did not match'); continue; }
    break;
  }

  // Check if user already exists
  const { rows: existing } = await pool.query(
    'SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let userId;
  if (existing.length > 0) {
    const updateConfirm = (await ask(
      `A user with this email already exists (role: ${existing[0].role}). Update password and promote to admin? (yes/no): `
    )).toLowerCase();
    if (updateConfirm !== 'yes') {
      console.log('Aborted.');
      await pool.end(); rl.close();
      return;
    }
    userId = existing[0].id;
    await pool.query(
      `UPDATE users
         SET password_hash = $1, first_name = $2, last_name = $3,
             role = 'admin', is_active = TRUE, updated_at = NOW()
       WHERE id = $4`,
      [hash, firstName, lastName, userId]
    );
    console.log(`\n✓ Updated existing user ${email} and promoted to admin.`);
  } else {
    const { rows: inserted } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'admin', TRUE)
       RETURNING id`,
      [email, hash, firstName, lastName]
    );
    userId = inserted[0].id;
    console.log(`\n✓ Created admin user ${email}.`);
  }

  // Backfill existing searches that have no owner yet
  const { rows: orphanCount } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM searches WHERE created_by IS NULL'
  );
  const cnt = orphanCount[0].cnt;
  if (cnt > 0) {
    const backfillConfirm = (await ask(
      `There are ${cnt} existing search(es) with no owner. Assign them to this admin? (yes/no): `
    )).toLowerCase();
    if (backfillConfirm === 'yes') {
      const { rowCount } = await pool.query(
        'UPDATE searches SET created_by = $1, updated_by = $1 WHERE created_by IS NULL',
        [userId]
      );
      console.log(`✓ Backfilled ${rowCount} search(es).`);
    } else {
      console.log('Skipped backfill. Existing searches remain ownerless until backfilled later.');
    }
  } else {
    console.log('No ownerless searches to backfill.');
  }

  await pool.end();
  rl.close();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
