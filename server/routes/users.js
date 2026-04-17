'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const VALID_ROLES = ['admin', 'consultant', 'analyst'];

function initialsFor(first, last) {
  const a = (first || '').trim().charAt(0).toUpperCase();
  const b = (last || '').trim().charAt(0).toUpperCase();
  return (a + b) || '?';
}

function validEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function validPasswordErr(s) {
  if (typeof s !== 'string' || s.length < 12) return 'Password must be at least 12 characters';
  if (!/[a-z]/.test(s)) return 'Password must contain a lowercase letter';
  if (!/[A-Z]/.test(s)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(s)) return 'Password must contain a digit';
  return null;
}

async function countActiveAdmins(excludingId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM users
      WHERE role = 'admin' AND is_active = TRUE
        AND ($1::uuid IS NULL OR id <> $1)`,
    [excludingId || null]
  );
  return rows[0].cnt;
}

// ── GET /api/users/team ──────────────────────────────────────────────────────
// Lightweight list for team pickers. Any authenticated user.
router.get('/team', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, role
         FROM users
        WHERE is_active = TRUE
        ORDER BY first_name, last_name`
    );
    res.json({
      users: rows.map(r => ({
        id: r.id,
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        initials: initialsFor(r.first_name, r.last_name),
        role: r.role
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin-only endpoints below ───────────────────────────────────────────────
router.use(requireRole('admin'));

// GET /api/users — full user list with stats
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
              u.last_login_at, u.created_at,
              (SELECT COUNT(*) FROM searches s WHERE s.created_by = u.id)::int AS owned_searches,
              (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id AND s.expires_at > NOW())::int AS active_sessions
         FROM users u
        ORDER BY u.is_active DESC, u.last_name, u.first_name`
    );
    res.json({
      users: rows.map(r => ({
        id: r.id,
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        initials: initialsFor(r.first_name, r.last_name),
        role: r.role,
        is_active: r.is_active,
        last_login_at: r.last_login_at,
        created_at: r.created_at,
        owned_searches: r.owned_searches,
        active_sessions: r.active_sessions
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — create a new user
// Body: { email, first_name, last_name, role, password }
router.post('/', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const firstName = (req.body.first_name || '').trim();
    const lastName = (req.body.last_name || '').trim();
    const role = (req.body.role || 'consultant').trim();
    const password = req.body.password || '';

    if (!validEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name are required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const pwErr = validPasswordErr(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [email]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'A user with this email already exists' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [email, hash, firstName, lastName, role]
    );
    const u = rows[0];
    res.status(201).json({
      user: {
        id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name,
        initials: initialsFor(u.first_name, u.last_name),
        role: u.role, is_active: u.is_active, created_at: u.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id — update role / active status / name
router.patch('/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    const { rows: tRows } = await pool.query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1',
      [targetId]
    );
    if (tRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = tRows[0];

    const updates = [];
    const params = [];
    let idx = 1;

    if (req.body.first_name !== undefined) {
      const v = (req.body.first_name || '').trim();
      if (!v) return res.status(400).json({ error: 'first_name cannot be empty' });
      updates.push(`first_name = $${idx++}`); params.push(v);
    }
    if (req.body.last_name !== undefined) {
      const v = (req.body.last_name || '').trim();
      if (!v) return res.status(400).json({ error: 'last_name cannot be empty' });
      updates.push(`last_name = $${idx++}`); params.push(v);
    }
    if (req.body.role !== undefined) {
      const v = req.body.role;
      if (!VALID_ROLES.includes(v)) return res.status(400).json({ error: 'Invalid role' });
      // Guard: can't demote yourself if you'd be the last admin
      if (target.id === req.user.id && target.role === 'admin' && v !== 'admin') {
        const others = await countActiveAdmins(target.id);
        if (others === 0) return res.status(400).json({ error: 'You are the only admin; promote another admin first' });
      }
      updates.push(`role = $${idx++}`); params.push(v);
    }
    if (req.body.is_active !== undefined) {
      const v = !!req.body.is_active;
      // Guard: can't deactivate self
      if (target.id === req.user.id && !v) {
        return res.status(400).json({ error: 'You cannot deactivate yourself' });
      }
      // Guard: can't deactivate the last active admin
      if (target.role === 'admin' && !v) {
        const others = await countActiveAdmins(target.id);
        if (others === 0) return res.status(400).json({ error: 'Cannot deactivate the only active admin' });
      }
      updates.push(`is_active = $${idx++}`); params.push(v);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No changes provided' });

    updates.push(`updated_at = NOW()`);
    params.push(targetId);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(',')} WHERE id = $${idx}
       RETURNING id, email, first_name, last_name, role, is_active, last_login_at, created_at`,
      params
    );
    const u = rows[0];

    // If deactivated, kill their sessions
    if (req.body.is_active === false) {
      await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [targetId]);
    }

    res.json({
      user: {
        id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name,
        initials: initialsFor(u.first_name, u.last_name),
        role: u.role, is_active: u.is_active,
        last_login_at: u.last_login_at, created_at: u.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/reset-password — set a new password for a user
// Body: { password }
router.post('/:id/reset-password', async (req, res) => {
  try {
    const password = req.body.password || '';
    const pwErr = validPasswordErr(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hash, req.params.id]
    );
    // Invalidate all of the user's sessions
    await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/revoke-sessions — force sign-out on all devices
router.post('/:id/revoke-sessions', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const { rowCount } = await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true, revoked: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
