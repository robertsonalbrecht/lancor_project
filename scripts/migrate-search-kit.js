'use strict';

/**
 * Migrate search_kit data from active_searches.json into search_templates table.
 * Each non-empty item in boolean_strings, ideal_candidate_profiles,
 * pitchbook_params, screen_question_guides, and outreach_messages
 * becomes a row in search_templates with the correct search_id.
 *
 * Safe to run multiple times — uses ON CONFLICT (slug) DO NOTHING.
 * Does NOT modify any JSON files.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../server/db');

const TYPE_MAP = {
  boolean_strings:          'boolean_string',
  pitchbook_params:         'pitchbook_param',
  ideal_candidate_profiles: 'ideal_candidate_profile',
  screen_question_guides:   'screen_question_guide'
};

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

async function main() {
  const dataPath = path.join(__dirname, '..', 'data', 'active_searches.json');
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const searches = Array.isArray(raw) ? raw : (raw.searches || []);

  console.log(`Found ${searches.length} searches in active_searches.json\n`);

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const search of searches) {
    const searchSlug = search.search_id || search.id;
    const kit = search.search_kit || {};

    // Look up search UUID by slug
    const { rows: searchRows } = await pool.query(
      'SELECT id FROM searches WHERE slug = $1', [searchSlug]
    );
    if (searchRows.length === 0) {
      console.log(`SKIP search "${searchSlug}" — not found in searches table`);
      continue;
    }
    const searchUuid = searchRows[0].id;
    console.log(`Search: ${searchSlug} (${searchUuid})`);

    // Process each template type
    for (const [jsonKey, templateType] of Object.entries(TYPE_MAP)) {
      const items = kit[jsonKey] || [];
      if (items.length === 0) {
        console.log(`  ${jsonKey}: empty, skipping`);
        continue;
      }

      for (const item of items) {
        const content = JSON.stringify(item);
        if (!content || content === '{}' || content === '""') continue;

        const name = item.name || item.id || `${templateType}-${Date.now()}`;
        const slug = slugify(name) || `${templateType}-${Date.now()}`;

        const { rowCount } = await pool.query(
          `INSERT INTO search_templates (template_type, slug, name, content, search_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (slug) DO NOTHING`,
          [templateType, slug, name, content, searchUuid]
        );

        if (rowCount > 0) {
          console.log(`  INSERT ${templateType}: "${name}" (slug: ${slug})`);
          totalInserted++;
        } else {
          console.log(`  SKIP ${templateType}: "${name}" (slug already exists)`);
          totalSkipped++;
        }
      }
    }

    // Handle outreach_messages separately (not in the CHECK constraint types)
    const messages = kit.outreach_messages || [];
    if (messages.length > 0) {
      for (const msg of messages) {
        const content = JSON.stringify(msg);
        if (!content || content === '{}' || content === '""') continue;

        const name = msg.name || msg.subject || msg.id || `outreach-${Date.now()}`;
        const slug = slugify(name) || `outreach-${Date.now()}`;

        // Outreach messages go into outreach_messages table, not search_templates
        // Skip them here since they have their own table
        console.log(`  SKIP outreach_message: "${name}" (stored in outreach_messages table)`);
      }
    }

    console.log('');
  }

  console.log(`Done. Inserted: ${totalInserted}, Skipped: ${totalSkipped}`);
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
