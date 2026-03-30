/* ── Lancor Search OS — dashboard.js ─────────────────────────────────────────
   Client Dashboard Generator — Session 6
   Called from searches.js Weekly Updates tab "Generate Dashboard" button.
   ──────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Generate dashboard for a search ──────────────────────────────────────────

async function generateClientDashboard(searchId) {
  const btn = document.getElementById('generate-dashboard-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

  try {
    const result = await api('POST', '/searches/' + searchId + '/dashboard', {});

    // Show success banner with preview + download link
    showDashboardResult(result, searchId);

    // Refresh weekly updates tab to show new history entry
    if (typeof currentSearchData !== 'undefined' && currentSearchData) {
      const updated = await api('GET', '/searches/' + searchId);
      // Update the weekly updates list if it exists on page
      const historyEl = document.getElementById('dashboard-history');
      if (historyEl) renderDashboardHistory(historyEl, updated.weekly_updates || []);
    }
  } catch (e) {
    appAlert('Error generating dashboard: ' + e.message, { type: 'error' });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Dashboard'; }
  }
}

function showDashboardResult(result, searchId) {
  // Remove any existing result banner
  const existing = document.getElementById('dashboard-result-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'dashboard-result-banner';
  banner.style.cssText = 'background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:14px 18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px';
  banner.innerHTML = `
    <div>
      <div style="font-weight:700;color:#2e7d32;font-size:14px">&#10003; Dashboard generated</div>
      <div style="font-size:12px;color:#555;margin-top:3px">${result.filename}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary btn-sm" onclick="previewDashboard('${searchId}')">Preview</button>
      <button class="btn btn-primary btn-sm" onclick="printDashboard('${searchId}')">Print / PDF</button>
    </div>
  `;

  // Insert before the generate button
  const btn = document.getElementById('generate-dashboard-btn');
  if (btn && btn.parentNode) {
    btn.parentNode.insertBefore(banner, btn);
  } else {
    const tabContent = document.getElementById('tab-content');
    if (tabContent) tabContent.prepend(banner);
  }
}

async function previewDashboard(searchId) {
  try {
    const result = await api('POST', '/searches/' + searchId + '/dashboard', {});
    const win = window.open('', '_blank');
    win.document.write(result.html);
    win.document.close();
  } catch (e) {
    appAlert('Error previewing dashboard: ' + e.message, { type: 'error' });
  }
}

async function printDashboard(searchId) {
  try {
    const result = await api('POST', '/searches/' + searchId + '/dashboard', {});
    const win = window.open('', '_blank');
    win.document.write(result.html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  } catch (e) {
    appAlert('Error printing dashboard: ' + e.message, { type: 'error' });
  }
}

function renderDashboardHistory(containerEl, weeklyUpdates) {
  const generated = (weeklyUpdates || []).filter(u => u.dashboard_generated && u.dashboard_path);
  if (generated.length === 0) {
    containerEl.innerHTML = '<p style="color:#aaa;font-size:13px">No dashboards generated yet.</p>';
    return;
  }
  containerEl.innerHTML = generated.slice().reverse().map(u => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px">
      <span>${formatDate(u.update_date)} \u2014 ${u.dashboard_path.split('/').pop()}</span>
    </div>
  `).join('');
}
