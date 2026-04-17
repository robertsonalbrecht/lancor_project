'use strict';

const crypto = require('crypto');
const pool = require('../db');

const SESSION_COOKIE = 'lancor_session';
const SESSION_DAYS = 7;

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  };
}

// Look up the session from the cookie, attach req.user if valid.
// Never throws — returns null on any failure.
async function loadSession(req) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
              s.id AS session_id, s.expires_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.session_token = $1
          AND s.expires_at > NOW()
          AND u.is_active = TRUE
        LIMIT 1`,
      [token]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      role: r.role,
      sessionId: r.session_id,
      expiresAt: r.expires_at
    };
  } catch (err) {
    console.error('[auth] loadSession failed:', err.message);
    return null;
  }
}

// Middleware: attach req.user if logged in, but never block. Used on public
// endpoints that still want to know who the caller is (e.g. /api/config).
function attachUser(req, res, next) {
  loadSession(req).then((user) => { req.user = user; next(); });
}

// Middleware: require a valid session OR the Chrome-extension token on
// /api/candidates/prefill. 401 otherwise.
function requireAuth(req, res, next) {
  // Chrome extension token path — exempts /candidates/prefill only
  const extensionToken = process.env.CHROME_EXTENSION_TOKEN;
  if (req.path === '/candidates/prefill' && extensionToken) {
    const presented = req.get('X-API-Token');
    if (presented && presented === extensionToken) {
      req.user = { id: null, role: 'extension', email: 'chrome-extension' };
      return next();
    }
  }

  loadSession(req).then((user) => {
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  });
}

// Middleware factory: require one of the listed roles (after requireAuth).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = {
  SESSION_COOKIE,
  SESSION_DAYS,
  newSessionToken,
  cookieOptions,
  loadSession,
  attachUser,
  requireAuth,
  requireRole
};
