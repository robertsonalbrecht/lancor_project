'use strict';

// Search access control helpers.
//
// Access levels, in ascending order: view < edit < admin.
// Owner and system-admin are treated as 'admin' on every search.
// Granted access comes from the search_user_access table.

const pool = require('../db');

const LEVELS = { view: 1, edit: 2, admin: 3 };

// Compute a user's effective access level on a given search row.
// Returns 'none' | 'view' | 'edit' | 'admin'.
async function computeAccess(user, search) {
  if (!user) return 'none';
  if (user.role === 'admin') return 'admin';
  if (search.created_by && search.created_by === user.id) return 'admin';
  if (search.visibility === 'public') {
    // Public searches: everyone gets at least view; explicit grants can bump higher.
    const { rows } = await pool.query(
      'SELECT access_level FROM search_user_access WHERE search_id = $1 AND user_id = $2',
      [search.id, user.id]
    );
    if (rows.length > 0 && LEVELS[rows[0].access_level] > LEVELS.view) {
      return rows[0].access_level;
    }
    return 'view';
  }
  // Private: need an explicit grant
  const { rows } = await pool.query(
    'SELECT access_level FROM search_user_access WHERE search_id = $1 AND user_id = $2',
    [search.id, user.id]
  );
  if (rows.length === 0) return 'none';
  return rows[0].access_level;
}

// router.param handler: load the search by slug (`:id` in this codebase is the
// slug), attach req.search + req.searchAccess, 404 if missing, 403 if no access.
async function loadSearchAccess(req, res, next, slug) {
  try {
    const { rows } = await pool.query(
      'SELECT id, slug, visibility, created_by FROM searches WHERE slug = $1',
      [slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Search not found' });
    const search = rows[0];
    const level = await computeAccess(req.user, search);
    if (level === 'none') return res.status(403).json({ error: 'Forbidden' });
    req.search = search;
    req.searchAccess = level;
    next();
  } catch (err) {
    next(err);
  }
}

// Middleware factory: enforce minimum access level. Use AFTER loadSearchAccess.
function requireSearchLevel(minLevel) {
  return (req, res, next) => {
    if (!req.searchAccess) {
      return res.status(500).json({ error: 'loadSearchAccess middleware missing' });
    }
    if (LEVELS[req.searchAccess] >= LEVELS[minLevel]) return next();
    return res.status(403).json({ error: 'Insufficient access' });
  };
}

// SQL fragment + params to restrict a searches query to rows the user can see.
// Callers pass the next param index and get back a WHERE clause fragment
// (without the leading AND/WHERE) and the params to append.
//
// Example:
//   const vis = visibilityClause(req.user, paramIdx);
//   params.push(...vis.params);
//   sql += ' AND ' + vis.sql;
//   paramIdx += vis.params.length;
function visibilityClause(user, startIdx) {
  if (!user) return { sql: 'FALSE', params: [] };
  if (user.role === 'admin') return { sql: 'TRUE', params: [] };
  // Public OR owner OR explicitly granted
  const p1 = `$${startIdx}`;
  return {
    sql: `(s.visibility = 'public'
           OR s.created_by = ${p1}
           OR EXISTS (SELECT 1 FROM search_user_access sua
                       WHERE sua.search_id = s.id AND sua.user_id = ${p1}))`,
    params: [user.id]
  };
}

module.exports = {
  LEVELS,
  computeAccess,
  loadSearchAccess,
  requireSearchLevel,
  visibilityClause
};
