'use strict';

const express = require('express');
const router  = express.Router();
const pool    = require('../db');

const AI_FEATURES_ENABLED = process.env.ENABLE_AI_FEATURES !== 'false';

let _anthropic = null;
function getAnthropicClient() {
  if (!_anthropic && process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ── Voyage AI Embeddings ────────────────────────────────────────────────────

async function embedQuery(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`
    },
    body: JSON.stringify({
      model: 'voyage-3',
      input: [text],
      input_type: 'query'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

// ── System prompt for hard filter extraction ────────────────────────────────

const SYSTEM_PROMPT = `You are a query translator for an executive recruiting database. Extract ONLY hard filters from the natural language query — the semantic meaning will be handled by vector similarity search separately.

Only extract explicit, concrete filter constraints. Do NOT extract vague descriptive terms as filters — those are handled by semantic search.

Return ONLY valid JSON with these optional keys (omit keys that aren't relevant):

{
  "archetype": "PE Lateral",           // only if explicitly mentioned
  "archetypes": ["PE Lateral", "Industry Operator"],
  "sector_slugs": ["industrials"],     // sector slugs: "agriculture-fb", "business-services", "consumer", "financial-services", "healthcare", "industrials", "infrastructure-energy", "life-sciences", "media-entertainment", "real-estate-proptech", "tech-enabled-services", "technology-software"
  "size_tier": "Middle Market",        // "Mega", "Large", "Middle Market", "Lower Middle Market"
  "size_tiers": ["Middle Market", "Lower Middle Market"],
  "search_slug": "berkshire-industrials-2026",
  "pipeline_stage": "Pursuing",        // "Pursuing", "Outreach Sent", "Scheduling", "Qualifying", "Hold", "DQ", "DQ/Not Interested", "Interviewing", "NI"
  "pipeline_stages": ["Pursuing", "Qualifying"],
  "not_in_pipeline": true,
  "not_outreached": true,
  "availability": "Open",
  "min_quality_rating": 3,
  "limit": 25
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no prose
- Only extract hard categorical/boolean filters — skip descriptive/semantic terms
- If there are NO hard filters to extract, return {}
- "haven't been outreached" or "fresh candidates" → not_outreached: true
- "not in any search" → not_in_pipeline: true
- Default limit is 25`;

// ── POST /api/ai-search ────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    if (!AI_FEATURES_ENABLED) {
      return res.status(503).json({ error: 'AI features are disabled' });
    }

    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const client = getAnthropicClient();
    if (!client) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    if (!process.env.VOYAGE_API_KEY) {
      return res.status(400).json({ error: 'VOYAGE_API_KEY not configured' });
    }

    // Step 1: Extract hard filters via Claude + embed query via Voyage in parallel
    const [aiResponse, queryEmbedding] = await Promise.all([
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: query.trim() }]
      }),
      embedQuery(query.trim())
    ]);

    const rawText = aiResponse.content[0].text.trim();
    let filters;
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      filters = JSON.parse(cleaned);
    } catch (e) {
      return res.status(422).json({ error: 'Failed to parse AI response', raw: rawText });
    }

    // Step 2: Build and execute vector search with hard filters
    const { sql, params } = buildVectorQuery(filters, queryEmbedding);
    const { rows } = await pool.query(sql, params);

    // Step 3: Fetch sector tags, pipeline info, and work history for results
    const ids = rows.map(r => r.id);
    let sectorMap = {};
    let pipelineMap = {};
    let workHistoryMap = {};

    if (ids.length) {
      const [tagResult, pipResult, whResult] = await Promise.all([
        pool.query(
          `SELECT cst.candidate_id, s.slug FROM candidate_sector_tags cst
           JOIN sectors s ON s.id = cst.sector_id WHERE cst.candidate_id = ANY($1)`,
          [ids]
        ),
        pool.query(
          `SELECT sp.candidate_id, sp.stage, s.slug AS search_slug, s.client_name
           FROM search_pipeline sp JOIN searches s ON s.id = sp.search_id
           WHERE sp.candidate_id = ANY($1)`,
          [ids]
        ),
        pool.query(
          `SELECT candidate_id, title, company_name, dates, is_current
           FROM candidate_work_history WHERE candidate_id = ANY($1) ORDER BY sort_order`,
          [ids]
        )
      ]);

      tagResult.rows.forEach(r => (sectorMap[r.candidate_id] ||= []).push(r.slug));
      pipResult.rows.forEach(r => {
        (pipelineMap[r.candidate_id] ||= []).push({
          stage: r.stage, search_slug: r.search_slug, client_name: r.client_name
        });
      });
      whResult.rows.forEach(r => (workHistoryMap[r.candidate_id] ||= []).push(r));
    }

    // Rescale cosine distances to intuitive 0-100 scores
    // Raw cosine distance: 0 = identical, ~0.3 = strong match, ~0.7 = weak match, 1 = opposite
    // Map so that distance 0 → 99, distance 0.5 → ~60, distance 1.0 → 0
    const rawResults = rows.map(r => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      current_title: r.current_title,
      current_firm: r.current_firm,
      home_location: r.home_location,
      archetype: r.archetype,
      quality_rating: r.quality_rating,
      availability: r.availability,
      linkedin_url: r.linkedin_url,
      raw_distance: r.similarity,
      sectors: sectorMap[r.id] || [],
      pipeline: pipelineMap[r.id] || [],
      work_history: (workHistoryMap[r.id] || []).map(w => ({
        title: w.title, company: w.company_name, dates: w.dates, is_current: w.is_current
      }))
    }));

    // Relative scaling: best match in result set anchors at ~95%, rest scale down proportionally
    const distances = rawResults.map(r => r.raw_distance).filter(d => d != null);
    const bestDist = Math.min(...distances);
    const worstDist = Math.max(...distances);
    const spread = worstDist - bestDist || 0.01;

    const results = rawResults.map(r => {
      let score = null;
      if (r.raw_distance != null) {
        // Position in result set: 0 (best) to 1 (worst)
        const position = (r.raw_distance - bestDist) / spread;
        // Map to score range: best → 95, worst → max(40, 95 - spread*150)
        const floor = Math.max(40, Math.round(95 - spread * 150));
        score = Math.round(95 - position * (95 - floor));
      }
      return { ...r, similarity: score, raw_distance: undefined };
    });

    // Step 4: Generate match explanations via Claude
    const explanations = await generateMatchExplanations(client, query.trim(), results);
    results.forEach((r, i) => { r.match_reason = explanations[i] || null; });

    res.json({ filters, results, count: results.length, mode: 'semantic' });

  } catch (err) {
    console.error('AI search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Vector Query Builder ───────────────────────────────────────────────────

function buildVectorQuery(f, queryEmbedding) {
  const conditions = ['c.embedding IS NOT NULL'];
  const params = [];
  const joins = new Set();
  let p = 0;

  function addParam(val) { params.push(val); return `$${++p}`; }

  // The query embedding is always the first param
  const embeddingParam = addParam(`[${queryEmbedding.join(',')}]`);

  // Archetype
  if (f.archetype) {
    conditions.push(`c.archetype = ${addParam(f.archetype)}`);
  } else if (f.archetypes && f.archetypes.length) {
    conditions.push(`c.archetype = ANY(${addParam(f.archetypes)})`);
  }

  // Sector tags
  if (f.sector_slugs && f.sector_slugs.length) {
    joins.add('sector');
    conditions.push(`sec.slug = ANY(${addParam(f.sector_slugs)})`);
  }

  // Size tier
  if (f.size_tier) {
    joins.add('company');
    conditions.push(`co.size_tier = ${addParam(f.size_tier)}`);
  } else if (f.size_tiers && f.size_tiers.length) {
    joins.add('company');
    conditions.push(`co.size_tier = ANY(${addParam(f.size_tiers)})`);
  }

  // Pipeline filters
  if (f.search_slug || f.pipeline_stage || (f.pipeline_stages && f.pipeline_stages.length)) {
    joins.add('pipeline');
    if (f.search_slug) {
      joins.add('search');
      conditions.push(`srch.slug = ${addParam(f.search_slug)}`);
    }
    if (f.pipeline_stage) {
      conditions.push(`sp.stage = ${addParam(f.pipeline_stage)}`);
    } else if (f.pipeline_stages && f.pipeline_stages.length) {
      conditions.push(`sp.stage = ANY(${addParam(f.pipeline_stages)})`);
    }
  }

  if (f.not_in_pipeline) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM search_pipeline sp2 WHERE sp2.candidate_id = c.id)`);
  }

  if (f.not_outreached) {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM search_pipeline sp2
      WHERE sp2.candidate_id = c.id
        AND sp2.stage NOT IN ('DQ', 'DQ/Not Interested', 'NI', 'Hold')
    )`);
  }

  if (f.availability) {
    conditions.push(`c.availability = ${addParam(f.availability)}`);
  }

  if (f.min_quality_rating != null) {
    conditions.push(`c.quality_rating >= ${addParam(f.min_quality_rating)}`);
  }

  // Build JOINs
  let joinSQL = '';
  if (joins.has('sector')) {
    joinSQL += `\n  JOIN candidate_sector_tags cst ON cst.candidate_id = c.id
  JOIN sectors sec ON sec.id = cst.sector_id`;
  }
  if (joins.has('company')) {
    joinSQL += `\n  LEFT JOIN companies co ON co.slug = LOWER(REPLACE(REPLACE(c.current_firm, ' ', '-'), '.', ''))`;
  }
  if (joins.has('pipeline')) {
    joinSQL += `\n  JOIN search_pipeline sp ON sp.candidate_id = c.id`;
  }
  if (joins.has('search')) {
    joinSQL += `\n  JOIN searches srch ON srch.id = sp.search_id`;
  }

  const limit = Math.min(Math.max(parseInt(f.limit) || 25, 1), 100);
  const where = conditions.length ? `WHERE ${conditions.join('\n    AND ')}` : '';

  const sql = `SELECT DISTINCT c.id, c.slug, c.name, c.current_title, c.current_firm,
    c.home_location, c.archetype, c.quality_rating, c.availability,
    c.linkedin_url, c.date_added,
    c.embedding <=> ${embeddingParam}::vector AS similarity
  FROM candidates c${joinSQL}
  ${where}
  ORDER BY similarity ASC
  LIMIT ${limit}`;

  return { sql, params };
}

// ── Match Explanation Generator ────────────────────────────────────────────

async function generateMatchExplanations(client, query, results) {
  if (!results.length) return [];

  const candidateSummaries = results.map((r, i) => {
    const whLines = (r.work_history || []).slice(0, 8).map(w => {
      const current = w.is_current ? ' (current)' : '';
      return `  - ${w.title || '?'} at ${w.company || '?'}${w.dates ? `, ${w.dates}` : ''}${current}`;
    }).join('\n');

    return `[${i}] ${r.name}
  Current: ${r.current_title || '?'} at ${r.current_firm || '?'}
  Archetype: ${r.archetype || 'None'}
  Sectors: ${r.sectors.join(', ') || 'none'}
  Location: ${r.home_location || '?'}
  Match score: ${r.similarity}%
  Career:
${whLines || '  (no history)'}`;
  }).join('\n\n');

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are an expert executive recruiter evaluating candidate fit. For each candidate, write a 2-3 sentence explanation with two parts:

**Strengths** — What specifically in their profile matches the search. Reference actual companies, titles, industries, and career trajectory.
**Gaps** — What's missing or only partially matching. Be specific: wrong sector focus, missing consulting background, wrong seniority level, no direct industry operating experience, etc.

Be honest and direct. If someone is a near-perfect match, say so and note any minor gaps. If they're a weak match, explain what's missing.

Return ONLY a JSON array of strings, one per candidate, in the same order. No markdown fences, no wrapping.`,
      messages: [{
        role: 'user',
        content: `Search query: "${query}"\n\nCandidates:\n${candidateSummaries}`
      }]
    });

    const raw = resp.content[0].text.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Match explanation error:', err.message);
    return results.map(() => null);
  }
}

module.exports = router;
