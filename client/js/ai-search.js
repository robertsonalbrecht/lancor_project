/* global api, navigateTo, escapeHtml */

// ── AI Search Module ──────────────────────────────────────────────────────────

function renderAiSearch() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <div class="ai-search-page">
      <div class="ai-search-header">
        <h1>AI Candidate Search</h1>
        <p class="ai-search-subtitle">Searching full candidate profiles semantically via vector embeddings</p>
      </div>

      <div class="ai-search-bar-wrap">
        <textarea id="ai-search-input" class="ai-search-input"
          placeholder="e.g. PE laterals with industrial operations experience at a Middle Market fund who haven't been outreached"
          rows="2"></textarea>
        <button id="ai-search-btn" class="btn btn-primary ai-search-btn" onclick="runAiSearch()">
          Search
        </button>
      </div>

      <div id="ai-search-filters" class="ai-search-filters" style="display:none"></div>
      <div id="ai-search-status" class="ai-search-status"></div>
      <div id="ai-search-results" class="ai-search-results"></div>
    </div>
  `;

  const input = document.getElementById('ai-search-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAiSearch(); }
  });
  input.focus();
}

async function runAiSearch() {
  const input = document.getElementById('ai-search-input');
  const btn = document.getElementById('ai-search-btn');
  const statusEl = document.getElementById('ai-search-status');
  const filtersEl = document.getElementById('ai-search-filters');
  const resultsEl = document.getElementById('ai-search-results');

  const query = input.value.trim();
  if (!query) return;

  btn.disabled = true;
  btn.textContent = 'Searching...';
  statusEl.innerHTML = '<div class="ai-search-loading">Embedding query &amp; searching candidate profiles...</div>';
  filtersEl.style.display = 'none';
  resultsEl.innerHTML = '';

  try {
    const data = await api('POST', '/ai-search', { query });

    // Show interpreted filters
    filtersEl.style.display = 'block';
    filtersEl.innerHTML = renderFiltersCard(data.filters);

    // Show results
    statusEl.innerHTML = `<span class="ai-search-count">${data.count} candidate${data.count !== 1 ? 's' : ''} found — ranked by semantic similarity</span>`;
    resultsEl.innerHTML = data.results.length
      ? data.results.map(renderResultCard).join('')
      : '<div class="empty-state">No candidates match this query. Try broadening your search or check that embeddings have been generated.</div>';

  } catch (err) {
    statusEl.innerHTML = `<div class="ai-search-error">Error: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
  }
}

function renderFiltersCard(filters) {
  const labels = {
    archetype: 'Archetype', archetypes: 'Archetypes',
    sector_slugs: 'Sectors', size_tier: 'Firm Size', size_tiers: 'Firm Sizes',
    search_slug: 'In Search', pipeline_stage: 'Pipeline Stage', pipeline_stages: 'Pipeline Stages',
    not_in_pipeline: 'Not In Pipeline', not_outreached: 'Not Outreached',
    availability: 'Availability', min_quality_rating: 'Min Quality', limit: 'Limit'
  };

  const hardFilters = Object.entries(filters).filter(([k]) => k in labels);

  const chips = hardFilters.map(([key, val]) => {
    const label = labels[key] || key;
    const display = Array.isArray(val) ? val.join(', ') : String(val);
    return `<span class="ai-filter-chip"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(display)}</span>`;
  });

  const semanticNote = '<span class="ai-filter-chip ai-filter-semantic">Semantic matching handles the rest</span>';

  return `
    <div class="ai-filters-card">
      <div class="ai-filters-label">Hard filters applied:</div>
      <div class="ai-filters-chips">
        ${chips.length ? chips.join('') : '<span class="ai-filter-chip">None — pure semantic search</span>'}
        ${semanticNote}
      </div>
    </div>
  `;
}

function renderResultCard(c) {
  const sectorTags = c.sectors.map(s =>
    `<span class="tag tag-sector">${escapeHtml(s)}</span>`
  ).join('');

  const pipelineInfo = c.pipeline.length
    ? c.pipeline.map(p =>
        `<span class="tag tag-stage tag-stage-${(p.stage || '').toLowerCase().replace(/[^a-z]/g, '')}">${escapeHtml(p.stage || 'Unknown')}</span>
         <span class="ai-search-pipeline-search">${escapeHtml(p.client_name || p.search_slug)}</span>`
      ).join(' ')
    : '<span class="tag tag-none">Not in pipeline</span>';

  const archetypeBadge = c.archetype
    ? `<span class="tag tag-archetype">${escapeHtml(c.archetype)}</span>`
    : '';

  const qualityStars = c.quality_rating
    ? `<span class="ai-search-stars">${'★'.repeat(c.quality_rating)}${'☆'.repeat(5 - c.quality_rating)}</span>`
    : '';

  const similarityBadge = c.similarity != null
    ? `<span class="tag tag-similarity">${c.similarity}% match</span>`
    : '';

  const matchReason = c.match_reason
    ? `<div class="ai-match-reason">${escapeHtml(c.match_reason)}</div>`
    : '';

  return `
    <div class="ai-result-card" onclick="openCandidatePanel('${c.slug}')">
      <div class="ai-result-header">
        <div class="ai-result-name">${escapeHtml(c.name)}</div>
        <div class="ai-result-meta">
          ${similarityBadge}
          ${archetypeBadge}
          ${qualityStars}
        </div>
      </div>
      <div class="ai-result-title">${escapeHtml(c.current_title || '')}${c.current_firm ? ' at <strong>' + escapeHtml(c.current_firm) + '</strong>' : ''}</div>
      ${c.home_location ? `<div class="ai-result-location">${escapeHtml(c.home_location)}</div>` : ''}
      ${matchReason}
      <div class="ai-result-tags">
        <div class="ai-result-pipeline">${pipelineInfo}</div>
        <div class="ai-result-sectors">${sectorTags}</div>
      </div>
    </div>
  `;
}
