/* global api, escapeHtml, currentSearchId */

// ── Search Analytics Tab ──────────────────────────────────────────────────────

let _searchAnalyticsCharts = {};

function renderSearchAnalyticsTabHTML() {
  return `
    <div class="search-analytics" id="search-analytics-root">
      <div class="analytics-loading">Loading analytics...</div>
    </div>
  `;
}

async function loadSearchAnalyticsTab() {
  const root = document.getElementById('search-analytics-root');
  if (!root || !currentSearchId) return;

  // Ensure Chart.js is loaded
  if (typeof Chart === 'undefined') {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  try {
    const data = await api('GET', '/searches/' + currentSearchId + '/analytics');
    renderSearchAnalytics(root, data);
  } catch (err) {
    root.innerHTML = `<div class="error-banner">Failed to load analytics: ${escapeHtml(err.message)}</div>`;
  }
}

function renderSearchAnalytics(root, data) {
  // Destroy existing charts
  Object.values(_searchAnalyticsCharts).forEach(c => c.destroy && c.destroy());
  _searchAnalyticsCharts = {};

  root.innerHTML = `
    <div class="sa-grid">
      <!-- Export -->
      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn-primary btn-sm" onclick="downloadSearchExport()">Export Search Data (XLSX)</button>
      </div>

      <!-- Pipeline Section -->
      <div class="analytics-card sa-card-full">
        <h2 class="analytics-card-title">Pipeline</h2>
        ${data.pipeline ? renderPipelineSection(data.pipeline) : '<p class="sa-na">Data unavailable</p>'}
      </div>

      <!-- Coverage Section -->
      <div class="analytics-card sa-card-full">
        <h2 class="analytics-card-title">Coverage</h2>
        ${data.coverage ? renderCoverageSection(data.coverage) : '<p class="sa-na">Data unavailable</p>'}
      </div>

      <!-- Geography Section -->
      <div class="analytics-card sa-card-full">
        <h2 class="analytics-card-title">Geography</h2>
        ${data.geography ? '<div class="sa-chart-box" style="height:300px"><canvas id="sa-geo-chart"></canvas></div>' : '<p class="sa-na">Data unavailable</p>'}
      </div>

      <!-- Velocity Section -->
      <div class="analytics-card sa-card-full">
        <h2 class="analytics-card-title">Velocity</h2>
        ${data.velocity ? '<div class="sa-chart-box" style="height:240px"><canvas id="sa-velocity-chart"></canvas></div>' : '<p class="sa-na">Data unavailable</p>'}
      </div>
    </div>
  `;

  // Render charts after DOM is ready
  setTimeout(() => {
    if (data.pipeline) renderPipelineCharts(data.pipeline);
    if (data.coverage) renderCoverageCharts(data.coverage);
    if (data.geography) renderGeoChart(data.geography);
    if (data.velocity) renderVelocityChart(data.velocity);
  }, 50);
}

// ── Pipeline Section ────────────────────────────────────────────────────────

function renderPipelineSection(p) {
  const totalPipeline = p.stages.reduce((s, r) => s + r.cnt, 0);
  const meetingsNote = p.client_meetings > 0
    ? `<div class="sa-stat-pill">${p.client_meetings} client meeting${p.client_meetings !== 1 ? 's' : ''}</div>`
    : '';

  const dqSection = p.dq_reasons && p.dq_reasons.length > 0
    ? `<div class="sa-chart-half"><h3>DQ Reasons</h3><div class="sa-chart-box"><canvas id="sa-dq-chart"></canvas></div></div>`
    : '';

  return `
    <div class="sa-stat-row">
      <div class="sa-stat-pill">${totalPipeline} total candidates</div>
      ${meetingsNote}
    </div>
    <div class="analytics-chart-row">
      <div class="sa-chart-half">
        <h3>Stage Distribution</h3>
        <div class="sa-chart-box"><canvas id="sa-stage-chart"></canvas></div>
      </div>
      <div class="sa-chart-half">
        <h3>Archetypes</h3>
        <div class="sa-chart-box"><canvas id="sa-archetype-chart"></canvas></div>
      </div>
      ${dqSection}
    </div>
  `;
}

function renderPipelineCharts(p) {
  const stageColors = {
    'Pursuing': '#1565c0', 'Outreach Sent': '#42a5f5', 'Scheduling': '#7e57c2',
    'Qualifying': '#e65100', 'Interviewing': '#2e7d32', 'Hold': '#ff8f00',
    'DQ': '#9e9e9e', 'DQ/Not Interested': '#bdbdbd', 'NI': '#e0e0e0', 'Unknown': '#f5f5f5'
  };

  // Stage bar chart
  const stageCtx = document.getElementById('sa-stage-chart');
  if (stageCtx && p.stages.length) {
    _searchAnalyticsCharts.stage = new Chart(stageCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: p.stages.map(r => r.stage),
        datasets: [{
          data: p.stages.map(r => r.cnt),
          backgroundColor: p.stages.map(r => stageColors[r.stage] || '#757575'),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { precision: 0 }, grid: { display: false } }, x: { grid: { display: false } } }
      }
    });
  }

  // Archetype donut
  const archCtx = document.getElementById('sa-archetype-chart');
  if (archCtx && p.archetypes.length) {
    _searchAnalyticsCharts.archetype = new Chart(archCtx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: p.archetypes.map(r => r.archetype),
        datasets: [{
          data: p.archetypes.map(r => r.cnt),
          backgroundColor: ['#6B2D5B', '#8B4D7B', '#A76D9B', '#C48DB8', '#D4A0C8', '#E8C8DF', '#9E9E9E']
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
      }
    });
  }

  // DQ reason bar (if any)
  const dqCtx = document.getElementById('sa-dq-chart');
  if (dqCtx && p.dq_reasons && p.dq_reasons.length) {
    _searchAnalyticsCharts.dq = new Chart(dqCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: p.dq_reasons.map(r => r.reason.length > 30 ? r.reason.slice(0, 30) + '...' : r.reason),
        datasets: [{
          data: p.dq_reasons.map(r => r.cnt),
          backgroundColor: '#c62828',
          borderRadius: 4
        }]
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

// ── Coverage Section ────────────────────────────────────────────────────────

function renderCoverageSection(c) {
  const reviewSummary = (c.review_status || []).map(r =>
    `<div class="sa-stat-pill">${r.cnt} ${r.status.toLowerCase()}</div>`
  ).join('');

  return `
    <div class="sa-stat-row">${reviewSummary}</div>
    <div class="analytics-chart-row">
      <div class="sa-chart-half">
        <h3>Coverage Status</h3>
        <div class="sa-chart-box"><canvas id="sa-coverage-status-chart"></canvas></div>
      </div>
      <div class="sa-chart-half">
        <h3>Top Yielding Firms</h3>
        ${c.top_yielding && c.top_yielding.length
          ? '<div class="sa-chart-box"><canvas id="sa-top-firms-chart"></canvas></div>'
          : '<p class="sa-na">No firms with pipeline candidates yet</p>'
        }
      </div>
    </div>
  `;
}

function renderCoverageCharts(c) {
  const statusColors = { 'In Progress': '#42a5f5', 'Complete': '#2e7d32', 'Archived': '#9e9e9e' };

  const statusCtx = document.getElementById('sa-coverage-status-chart');
  if (statusCtx && c.firm_status && c.firm_status.length) {
    _searchAnalyticsCharts.covStatus = new Chart(statusCtx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: c.firm_status.map(r => r.status),
        datasets: [{
          data: c.firm_status.map(r => r.cnt),
          backgroundColor: c.firm_status.map(r => statusColors[r.status] || '#757575')
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
      }
    });
  }

  const firmsCtx = document.getElementById('sa-top-firms-chart');
  if (firmsCtx && c.top_yielding && c.top_yielding.length) {
    _searchAnalyticsCharts.topFirms = new Chart(firmsCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: c.top_yielding.map(r => r.firm_name.length > 25 ? r.firm_name.slice(0, 25) + '...' : r.firm_name),
        datasets: [{
          label: 'In Pipeline',
          data: c.top_yielding.map(r => r.pipeline_count),
          backgroundColor: '#6B2D5B',
          borderRadius: 4
        }]
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

// ── Geography Section ───────────────────────────────────────────────────────

function renderGeoChart(geo) {
  const ctx = document.getElementById('sa-geo-chart');
  if (!ctx) return;

  // Merge pipeline and roster geo into unified state list
  const stateMap = {};
  (geo.pipeline || []).forEach(r => {
    if (!stateMap[r.state]) stateMap[r.state] = { pipeline: 0, roster: 0 };
    stateMap[r.state].pipeline += r.cnt;
  });
  (geo.roster || []).forEach(r => {
    if (!stateMap[r.state]) stateMap[r.state] = { pipeline: 0, roster: 0 };
    stateMap[r.state].roster += r.cnt;
  });

  const states = Object.entries(stateMap)
    .map(([state, counts]) => ({ state, ...counts, total: counts.pipeline + counts.roster }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  if (!states.length) return;

  _searchAnalyticsCharts.geo = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: states.map(s => s.state),
      datasets: [
        {
          label: 'Pipeline',
          data: states.map(s => s.pipeline),
          backgroundColor: '#6B2D5B',
          borderRadius: 4
        },
        {
          label: 'Roster',
          data: states.map(s => s.roster),
          backgroundColor: '#C48DB8',
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { stacked: true, ticks: { precision: 0 }, grid: { display: false } },
        y: { stacked: true, grid: { display: false } }
      }
    }
  });
}

// ── Velocity Section ────────────────────────────────────────────────────────

function renderVelocityChart(v) {
  const ctx = document.getElementById('sa-velocity-chart');
  if (!ctx) return;

  // Build 12-week labels
  const weeks = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    // Truncate to Monday
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    weeks.push(d.toISOString().split('T')[0]);
  }

  const weekLabels = weeks.map(w => {
    const d = new Date(w);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  // Map data to weeks
  function mapToWeeks(rows) {
    const byWeek = {};
    (rows || []).forEach(r => {
      const w = new Date(r.week).toISOString().split('T')[0];
      byWeek[w] = r.cnt;
    });
    return weeks.map(w => byWeek[w] || 0);
  }

  _searchAnalyticsCharts.velocity = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: weekLabels,
      datasets: [
        {
          label: 'Candidates Added',
          data: mapToWeeks(v.candidates_added),
          borderColor: '#6B2D5B',
          backgroundColor: 'rgba(107,45,91,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: 'Reviews Completed',
          data: mapToWeeks(v.reviews_completed),
          borderColor: '#42a5f5',
          backgroundColor: 'rgba(66,165,245,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: { ticks: { precision: 0 }, grid: { color: '#f0f0f0' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// ── Export ───────────────────────────────────────────────────────────────────

function downloadSearchExport() {
  if (!currentSearchId) return;
  const a = document.createElement('a');
  a.href = '/api/searches/' + encodeURIComponent(currentSearchId) + '/export';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
