'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const {
  SESSION_COOKIE,
  SESSION_DAYS,
  newSessionToken,
  cookieOptions,
  loadSession,
  requireAuth
} = require('../middleware/auth');

const router = express.Router();

// ── Rate limit on login to throttle brute-force attempts ───────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, password_hash, first_name, last_name, role, is_active FROM users WHERE LOWER(email) = $1',
      [email]
    );

    // Generic error — do not leak whether the email exists
    const badCreds = () => res.status(401).json({ error: 'Invalid email or password' });

    if (rows.length === 0) {
      // Spend the time a real hash check would take, so timing doesn't leak existence
      await bcrypt.compare(password, '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      return badCreds();
    }

    const user = rows[0];
    if (!user.is_active) return badCreds();

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return badCreds();

    // Create session
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO user_sessions (user_id, session_token, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, token, expiresAt, req.get('User-Agent') || null, req.ip || null]
    );

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    res.cookie(SESSION_COOKIE, token, cookieOptions());
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (token) {
    try {
      await pool.query('DELETE FROM user_sessions WHERE session_token = $1', [token]);
    } catch (err) {
      console.error('[auth] logout delete failed:', err.message);
    }
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const user = await loadSession(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      expiresAt: user.expiresAt
    }
  });
});

module.exports = router;
