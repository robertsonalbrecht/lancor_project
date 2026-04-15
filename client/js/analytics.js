/* global api, escapeHtml */

// ── Analytics Module ──────────────────────────────────────────────────────────

let _analyticsCharts = {};

function renderAnalytics() {
  const content = document.getElementById('app-content');
  content.innerHTML = `
    <div class="analytics-page">
      <div class="analytics-header">
        <h1>Analytics</h1>
      </div>

      <!-- Overview Section -->
      <div class="analytics-card" id="analytics-overview">
        <h2 class="analytics-card-title">Overview</h2>
        <div class="analytics-loading">Loading...</div>
      </div>

      <!-- Geography Section -->
      <div class="analytics-card" id="analytics-geography">
        <h2 class="analytics-card-title">
          Geography
          <div class="analytics-toggle">
            <button class="btn btn-sm btn-ghost analytics-geo-toggle active" data-mode="all" onclick="toggleGeoMode('all')">All Reviewed</button>
            <button class="btn btn-sm btn-ghost analytics-geo-toggle" data-mode="pipeline" onclick="toggleGeoMode('pipeline')">Pipeline Only</button>
          </div>
        </h2>
        <div class="analytics-chart-wrap">
          <canvas id="geo-chart" height="400"></canvas>
        </div>
      </div>

      <!-- Firm Intelligence Section -->
      <div class="analytics-card" id="analytics-firms">
        <h2 class="analytics-card-title">Firm Intelligence</h2>
        <div class="analytics-loading">Loading...</div>
      </div>

      <!-- Database Intelligence Section -->
      <div class="analytics-card" id="analytics-database">
        <h2 class="analytics-card-title">Database Intelligence</h2>
        <div class="analytics-loading">Loading...</div>
      </div>

      <!-- Exports Section -->
      <div class="analytics-card" id="analytics-exports">
        <h2 class="analytics-card-title">Exports</h2>
        <div class="analytics-export-buttons">
          <button class="btn btn-primary" onclick="downloadExport('candidates')">
            Export Candidate Review Log
          </button>
          <button class="btn btn-primary" onclick="downloadExport('coverage')">
            Export Coverage Summary
          </button>
        </div>
      </div>
    </div>
  `;

  // Load Chart.js from CDN if not present
  if (typeof Chart === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = () => loadAnalyticsData();
    document.head.appendChild(script);
  } else {
    loadAnalyticsData();
  }
}

async function loadAnalyticsData() {
  // Destroy existing charts
  Object.values(_analyticsCharts).forEach(c => c.destroy && c.destroy());
  _analyticsCharts = {};

  await Promise.all([
    loadOverview(),
    loadGeography(),
    loadFirms(),
    loadDatabaseIntelligence()
  ]);
}

// ── Overview ────────────────────────────────────────────────────────────────

async function loadOverview() {
  const container = document.getElementById('analytics-overview');
  try {
    const data = await api('GET', '/analytics/overview');

    const tiles = `
      <div class="analytics-tiles">
        <div class="analytics-tile">
          <div class="analytics-tile-value">${data.total_reviewed ?? '—'}</div>
          <div class="analytics-tile-label">Candidates Reviewed</div>
        </div>
        <div class="analytics-tile">
          <div class="analytics-tile-value">${data.active_pipeline ?? '—'}</div>
          <div class="analytics-tile-label">Active Pipeline</div>
        </div>
        <div class="analytics-tile">
          <div class="analytics-tile-value">${data.firms_covered ?? '—'}</div>
          <div class="analytics-tile-label">Firms Covered</div>
        </div>
      </div>
    `;

    // Archetype donut + stage breakdown
    const charts = `
      <div class="analytics-chart-row">
        <div class="analytics-chart-half">
          <h3>By Archetype</h3>
          <canvas id="archetype-chart" height="220"></canvas>
        </div>
        <div class="analytics-chart-half">
          <h3>By Stage</h3>
          <canvas id="stage-chart" height="220"></canvas>
        </div>
      </div>
    `;

    container.innerHTML = `<h2 class="analytics-card-title">Overview</h2>${tiles}${charts}`;

    // Render archetype donut
    if (data.by_archetype && typeof Chart !== 'undefined') {
      const ctx = document.getElementById('archetype-chart').getContext('2d');
      _analyticsCharts.archetype = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: data.by_archetype.map(r => r.archetype),
          datasets: [{
            data: data.by_archetype.map(r => r.cnt),
            backgroundColor: [
              '#6B2D5B', '#8B4D7B', '#A76D9B', '#C48DB8', '#D4A0C8',
              '#E8C8DF', '#F3E8EF', '#9E9E9E', '#BDBDBD', '#E0E0E0'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
        }
      });
    }

    // Render stage donut
    if (data.by_stage && typeof Chart !== 'undefined') {
      const stageColors = {
        'Pursuing': '#1565c0', 'Outreach Sent': '#42a5f5', 'Scheduling': '#7e57c2',
        'Qualifying': '#e65100', 'Interviewing': '#2e7d32', 'Hold': '#c62828',
        'DQ': '#9e9e9e', 'DQ/Not Interested': '#bdbdbd', 'NI': '#e0e0e0', 'Unknown': '#f5f5f5'
      };
      const ctx = document.getElementById('stage-chart').getContext('2d');
      _analyticsCharts.stage = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: data.by_stage.map(r => r.stage),
          datasets: [{
            data: data.by_stage.map(r => r.cnt),
            backgroundColor: data.by_stage.map(r => stageColors[r.stage] || '#757575')
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
        }
      });
    }
  } catch (err) {
    container.innerHTML += `<div class="analytics-error">Failed to load overview: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Geography ───────────────────────────────────────────────────────────────

let _geoData = null;

async function loadGeography() {
  try {
    const data = await api('GET', '/analytics/geography');
    _geoData = data.states;
    renderGeoChart('all');
  } catch (err) {
    document.getElementById('analytics-geography').innerHTML +=
      `<div class="analytics-error">Failed to load geography: ${escapeHtml(err.message)}</div>`;
  }
}

function toggleGeoMode(mode) {
  document.querySelectorAll('.analytics-geo-toggle').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  renderGeoChart(mode);
}

function renderGeoChart(mode) {
  if (!_geoData || typeof Chart === 'undefined') return;

  if (_analyticsCharts.geo) _analyticsCharts.geo.destroy();

  const PIPELINE_STAGES = ['Qualifying', 'Interviewing', 'Pursuing', 'Scheduling', 'Outreach Sent'];

  let filtered;
  if (mode === 'pipeline') {
    // Recompute totals counting only pipeline stages
    filtered = _geoData.map(s => {
      const pipTotal = PIPELINE_STAGES.reduce((sum, st) => sum + (s.stages[st] || 0), 0);
      return { state: s.state, total: pipTotal };
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);
  } else {
    filtered = _geoData;
  }

  const top20 = filtered.slice(0, 20);

  const ctx = document.getElementById('geo-chart').getContext('2d');
  _analyticsCharts.geo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top20.map(s => s.state),
      datasets: [{
        label: mode === 'pipeline' ? 'In Pipeline' : 'All Reviewed',
        data: top20.map(s => s.total),
        backgroundColor: '#6B2D5B',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { precision: 0 } },
        y: { grid: { display: false } }
      }
    }
  });
}

// ── Firm Intelligence ───────────────────────────────────────────────────────

let _firmData = null;
let _firmSort = { col: 'yield_rate', dir: 'desc' };

async function loadFirms() {
  const container = document.getElementById('analytics-firms');
  try {
    const data = await api('GET', '/analytics/firms');
    _firmData = data.firms;
    renderFirmTable();
  } catch (err) {
    container.innerHTML += `<div class="analytics-error">Failed to load firms: ${escapeHtml(err.message)}</div>`;
  }
}

function sortFirms(col) {
  if (_firmSort.col === col) {
    _firmSort.dir = _firmSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _firmSort.col = col;
    _firmSort.dir = 'desc';
  }
  renderFirmTable();
}

function renderFirmTable() {
  const container = document.getElementById('analytics-firms');
  if (!_firmData) {
    container.innerHTML = '<h2 class="analytics-card-title">Firm Intelligence</h2><p>No data available.</p>';
    return;
  }

  const sorted = [..._firmData].sort((a, b) => {
    const av = a[_firmSort.col], bv = b[_firmSort.col];
    if (typeof av === 'number' && typeof bv === 'number') {
      return _firmSort.dir === 'desc' ? bv - av : av - bv;
    }
    const as = String(av || ''), bs = String(bv || '');
    return _firmSort.dir === 'desc' ? bs.localeCompare(as) : as.localeCompare(bs);
  });

  function sortIcon(col) {
    if (_firmSort.col !== col) return '';
    return _firmSort.dir === 'desc' ? ' ▾' : ' ▴';
  }

  const headerCols = [
    { key: 'firm_name', label: 'Firm' },
    { key: 'firm_tier', label: 'Tier' },
    { key: 'total_identified', label: 'Identified' },
    { key: 'total_in_pipeline', label: 'In Pipeline' },
    { key: 'yield_rate', label: 'Yield Rate' }
  ];

  const thead = headerCols.map(h =>
    `<th class="sortable" onclick="sortFirms('${h.key}')">${h.label}${sortIcon(h.key)}</th>`
  ).join('');

  const tbody = sorted.slice(0, 100).map(f => `
    <tr>
      <td class="firm-name-cell">${escapeHtml(f.firm_name)}</td>
      <td><span class="tag tag-tier">${escapeHtml(f.firm_tier || '—')}</span></td>
      <td>${f.total_identified}</td>
      <td>${f.total_in_pipeline}</td>
      <td><strong>${f.yield_rate}%</strong></td>
    </tr>
  `).join('');

  container.innerHTML = `
    <h2 class="analytics-card-title">Firm Intelligence <span class="analytics-card-count">${_firmData.length} firms</span></h2>
    <div class="analytics-table-wrap">
      <table class="analytics-table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

// ── Database Intelligence ──────────────────────────────────────────────────

async function loadDatabaseIntelligence() {
  const container = document.getElementById('analytics-database');
  try {
    const d = await api('GET', '/analytics/database');
    renderDatabaseIntelligence(container, d);
  } catch (err) {
    container.innerHTML = `<h2 class="analytics-card-title">Database Intelligence</h2>
      <div class="analytics-error">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDatabaseIntelligence(container, d) {
  // Pipeline participation tiles
  const pp = d.candidate_pipeline_participation;
  const tilesHTML = pp ? `
    <div class="analytics-tiles" style="margin-bottom:24px">
      <div class="analytics-tile">
        <div class="analytics-tile-value">${pp.total_candidates.toLocaleString()}</div>
        <div class="analytics-tile-label">Total Candidates</div>
      </div>
      <div class="analytics-tile">
        <div class="analytics-tile-value">${pp.ever_pipelined.toLocaleString()}</div>
        <div class="analytics-tile-label">Ever Pipelined</div>
      </div>
      <div class="analytics-tile">
        <div class="analytics-tile-value">${pp.total_candidates > 0 ? Math.round((pp.ever_pipelined / pp.total_candidates) * 100) : 0}%</div>
        <div class="analytics-tile-label">Pipeline Rate</div>
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    <h2 class="analytics-card-title">Database Intelligence</h2>
    ${tilesHTML}
    <div class="analytics-chart-row" style="margin-bottom:24px">
      <div class="analytics-chart-half">
        <h3>Candidate Archetypes</h3>
        ${d.candidate_archetypes ? '<canvas id="db-archetype-chart" height="220"></canvas>' : '<p class="sa-na">Unavailable</p>'}
      </div>
      <div class="analytics-chart-half">
        <h3>Firm Tier Distribution</h3>
        ${d.firm_tier_distribution ? '<canvas id="db-tier-chart" height="220"></canvas>' : '<p class="sa-na">Unavailable</p>'}
      </div>
    </div>
    <div class="analytics-chart-row" style="margin-bottom:24px">
      <div class="analytics-chart-half">
        <h3>Candidate Geography — Top 20 States</h3>
        <div style="height:400px"><canvas id="db-geo-chart"></canvas></div>
      </div>
      <div class="analytics-chart-half">
        <h3>Sector Coverage (PE Firms)</h3>
        <div style="height:400px"><canvas id="db-sector-chart"></canvas></div>
      </div>
    </div>
    <div class="analytics-chart-row" style="margin-bottom:24px">
      <div class="analytics-chart-half">
        <h3>Database Growth (18 months)</h3>
        <div style="height:260px"><canvas id="db-growth-chart"></canvas></div>
      </div>
      <div class="analytics-chart-half">
        <h3>Coverage Confidence</h3>
        ${d.firm_coverage_confidence ? '<div style="height:260px"><canvas id="db-confidence-chart"></canvas></div>' : '<p class="sa-na">Unavailable</p>'}
      </div>
    </div>
    <div style="max-width:500px">
      <h3 style="font-size:0.9rem;color:var(--lancor-text-muted);margin:0 0 12px">Candidate Density per Firm</h3>
      ${d.firm_candidate_density ? '<div style="height:240px"><canvas id="db-density-chart"></canvas></div>' : '<p class="sa-na">Unavailable</p>'}
    </div>
  `;

  setTimeout(() => renderDatabaseCharts(d), 50);
}

function renderDatabaseCharts(d) {
  const purples = ['#6B2D5B', '#8B4D7B', '#A76D9B', '#C48DB8', '#D4A0C8', '#E8C8DF', '#F3E8EF', '#9E9E9E', '#BDBDBD', '#E0E0E0'];

  // (1) Archetype donut
  if (d.candidate_archetypes) {
    const ctx = document.getElementById('db-archetype-chart');
    if (ctx) {
      _analyticsCharts.dbArchetype = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: d.candidate_archetypes.map(r => r.archetype),
          datasets: [{ data: d.candidate_archetypes.map(r => r.cnt), backgroundColor: purples }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
        }
      });
    }
  }

  // (2) Candidate geography — horizontal bar
  if (d.candidate_geography) {
    const ctx = document.getElementById('db-geo-chart');
    if (ctx) {
      _analyticsCharts.dbGeo = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: d.candidate_geography.map(r => r.state),
          datasets: [{ data: d.candidate_geography.map(r => r.cnt), backgroundColor: '#6B2D5B', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { precision: 0 }, grid: { display: false } }, y: { grid: { display: false } } }
        }
      });
    }
  }

  // (3) Database growth — area chart, cumulative
  if (d.candidate_growth) {
    const ctx = document.getElementById('db-growth-chart');
    if (ctx) {
      let cumulative = 0;
      const cumData = d.candidate_growth.map(r => { cumulative += r.cnt; return cumulative; });
      const labels = d.candidate_growth.map(r => {
        const dt = new Date(r.month);
        return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      });

      _analyticsCharts.dbGrowth = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Cumulative Candidates Added',
            data: cumData,
            borderColor: '#6B2D5B',
            backgroundColor: 'rgba(107,45,91,0.12)',
            fill: true, tension: 0.3, pointRadius: 3
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { precision: 0 }, grid: { color: '#f0f0f0' } }, x: { grid: { display: false } } }
        }
      });
    }
  }

  // (5) Firm tier donut
  if (d.firm_tier_distribution) {
    const ctx = document.getElementById('db-tier-chart');
    if (ctx) {
      const tierColors = { 'Mega': '#6B2D5B', 'Large': '#8B4D7B', 'Middle Market': '#A76D9B', 'Lower Middle Market': '#C48DB8', 'Unknown': '#E0E0E0' };
      _analyticsCharts.dbTier = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: d.firm_tier_distribution.map(r => r.tier),
          datasets: [{
            data: d.firm_tier_distribution.map(r => r.cnt),
            backgroundColor: d.firm_tier_distribution.map(r => tierColors[r.tier] || '#9E9E9E')
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
        }
      });
    }
  }

  // (6) Sector coverage bar
  if (d.firm_sector_distribution) {
    const ctx = document.getElementById('db-sector-chart');
    if (ctx) {
      const sectorLabels = d.firm_sector_distribution.map(r =>
        r.sector.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      );
      _analyticsCharts.dbSector = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: sectorLabels,
          datasets: [{ data: d.firm_sector_distribution.map(r => r.cnt), backgroundColor: '#8B4D7B', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { precision: 0 }, grid: { display: false } }, y: { grid: { display: false } } }
        }
      });
    }
  }

  // (7) Coverage confidence bar
  if (d.firm_coverage_confidence) {
    const ctx = document.getElementById('db-confidence-chart');
    if (ctx) {
      const confColors = { 'Unsearched': '#e0e0e0', 'Low': '#ffcc80', 'Medium': '#81c784', 'High': '#2e7d32' };
      _analyticsCharts.dbConfidence = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: d.firm_coverage_confidence.map(r => r.confidence),
          datasets: [{
            data: d.firm_coverage_confidence.map(r => r.cnt),
            backgroundColor: d.firm_coverage_confidence.map(r => confColors[r.confidence] || '#9E9E9E'),
            borderRadius: 4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { precision: 0 }, grid: { color: '#f0f0f0' } }, x: { grid: { display: false } } }
        }
      });
    }
  }

  // (8) Candidate density histogram
  if (d.firm_candidate_density) {
    const ctx = document.getElementById('db-density-chart');
    if (ctx) {
      _analyticsCharts.dbDensity = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: d.firm_candidate_density.map(r => r.bucket + ' candidates'),
          datasets: [{
            data: d.firm_candidate_density.map(r => r.cnt),
            backgroundColor: ['#e0e0e0', '#C48DB8', '#A76D9B', '#8B4D7B', '#6B2D5B'],
            borderRadius: 4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { precision: 0 }, grid: { color: '#f0f0f0' } }, x: { grid: { display: false } } }
        }
      });
    }
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

function downloadExport(type) {
  const url = type === 'candidates'
    ? '/api/analytics/export/candidates'
    : '/api/analytics/export/coverage';

  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
