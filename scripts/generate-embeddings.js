'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = 'voyage-3';
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 500;

// ── Voyage AI Embeddings ────────────────────────────────────────────────────

async function getEmbeddings(texts) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VOYAGE_API_KEY}`
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: 'document'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.data.map(d => d.embedding);
}

// ── Profile Builder ─────────────────────────────────────────────────────────

function buildProfileText(candidate, workHistory, sectors) {
  const lines = [];

  lines.push(`Name: ${candidate.name}`);

  if (candidate.current_title || candidate.current_firm) {
    const role = [candidate.current_title, candidate.current_firm].filter(Boolean).join(' at ');
    lines.push(`Current Role: ${role}`);
  }

  if (candidate.archetype) {
    lines.push(`Archetype: ${candidate.archetype}`);
  }

  if (sectors.length) {
    lines.push(`Sectors: ${sectors.join(', ')}`);
  }

  if (candidate.home_location) {
    lines.push(`Location: ${candidate.home_location}`);
  }

  if (candidate.availability && candidate.availability !== 'Unknown') {
    lines.push(`Availability: ${candidate.availability}`);
  }

  if (candidate.operator_background && candidate.operator_background.length) {
    lines.push(`Background: ${candidate.operator_background.join(', ')}`);
  }

  if (workHistory.length) {
    lines.push('Career History:');
    for (const wh of workHistory) {
      const dates = wh.dates || [wh.start_date, wh.end_date || 'present'].filter(Boolean).join(' - ');
      const current = wh.is_current ? ' (current)' : '';
      lines.push(`- ${wh.title || 'Unknown'}, ${wh.company_name || 'Unknown'}${dates ? ` (${dates})` : ''}${current}`);
    }
  }

  if (candidate.notes) {
    lines.push(`Notes: ${candidate.notes}`);
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.ENABLE_AI_FEATURES === 'false') {
    console.log('AI features are disabled (ENABLE_AI_FEATURES=false). Skipping embedding generation.');
    process.exit(0);
  }

  if (!VOYAGE_API_KEY) {
    console.error('ERROR: VOYAGE_API_KEY not set in .env');
    console.error('Get a free key at https://dash.voyageai.com/');
    process.exit(1);
  }

  // Fetch candidates without embeddings (or all if --force)
  const force = process.argv.includes('--force');
  const whereClause = force ? '' : 'WHERE c.embedding IS NULL';

  const { rows: candidates } = await pool.query(`
    SELECT c.id, c.slug, c.name, c.current_title, c.current_firm,
           c.home_location, c.archetype, c.availability,
           c.operator_background, c.notes
    FROM candidates c
    ${whereClause}
    ORDER BY c.created_at
  `);

  console.log(`Found ${candidates.length} candidates to embed${force ? ' (force mode)' : ''}`);
  if (!candidates.length) {
    console.log('All candidates already have embeddings. Use --force to re-embed.');
    await pool.end();
    return;
  }

  const ids = candidates.map(c => c.id);

  // Fetch work history and sector tags in bulk
  const [whResult, sectorResult] = await Promise.all([
    pool.query(
      `SELECT candidate_id, title, company_name, dates, start_date, end_date, is_current
       FROM candidate_work_history WHERE candidate_id = ANY($1) ORDER BY sort_order`, [ids]
    ),
    pool.query(
      `SELECT cst.candidate_id, s.sector_name
       FROM candidate_sector_tags cst JOIN sectors s ON s.id = cst.sector_id
       WHERE cst.candidate_id = ANY($1)`, [ids]
    )
  ]);

  const whMap = {};
  whResult.rows.forEach(r => (whMap[r.candidate_id] ||= []).push(r));
  const sectorMap = {};
  sectorResult.rows.forEach(r => (sectorMap[r.candidate_id] ||= []).push(r.sector_name));

  // Process in batches
  let embedded = 0;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    const profiles = batch.map(c =>
      buildProfileText(c, whMap[c.id] || [], sectorMap[c.id] || [])
    );

    try {
      const embeddings = await getEmbeddings(profiles);

      // Store embeddings
      const now = new Date().toISOString();
      for (let j = 0; j < batch.length; j++) {
        const vecStr = `[${embeddings[j].join(',')}]`;
        await pool.query(
          `UPDATE candidates SET embedding = $1, embedding_updated_at = $2 WHERE id = $3`,
          [vecStr, now, batch[j].id]
        );
      }

      embedded += batch.length;
      console.log(`  Embedded ${embedded}/${candidates.length} candidates...`);

    } catch (err) {
      console.error(`  Error on batch starting at index ${i}:`, err.message);
      // Continue with next batch
    }

    // Rate limit delay between batches
    if (i + BATCH_SIZE < candidates.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`\nDone. ${embedded}/${candidates.length} candidates embedded.`);
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
