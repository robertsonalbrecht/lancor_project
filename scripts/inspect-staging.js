const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const dbInfo = await pool.query('SELECT current_database() AS db, inet_server_addr() AS host');
    console.log('Connected to:', dbInfo.rows[0]);
    console.log('---');

    const allSearches = await pool.query(`
      SELECT slug, client_name, role_title, status, date_opened, date_closed
      FROM searches
      ORDER BY status, date_opened DESC
    `);
    console.log('Total searches in staging:', allSearches.rowCount);
    console.table(allSearches.rows);

    const activeCount = await pool.query(`
      SELECT COUNT(*)::int AS active_count
      FROM searches
      WHERE status IN ('active','open')
    `);
    console.log('Active/open count (dashboard query):', activeCount.rows[0].active_count);
    console.log('---');

    const local = require('../data/active_searches.json').searches;
    const localSlugs = new Set(local.map(s => s.search_id));
    const stagingSlugs = new Set(allSearches.rows.map(r => r.slug));

    const inLocalNotStaging = [...localSlugs].filter(s => !stagingSlugs.has(s));
    const inStagingNotLocal = [...stagingSlugs].filter(s => !localSlugs.has(s));

    console.log('In local JSON but missing from staging:', inLocalNotStaging);
    console.log('In staging but not in local JSON:', inStagingNotLocal);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
