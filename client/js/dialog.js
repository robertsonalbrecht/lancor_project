/* ── Lancor Search OS — Custom Dialog System ─────────────────────────────── */
/* Replaces native alert(), confirm(), prompt() with styled dialogs.         */
/* Usage:                                                                     */
/*   await appAlert('Saved!', { type: 'success' })                           */
/*   if (!(await appConfirm('Delete?'))) return;                             */
/*   const name = await appPrompt('Enter name:', { placeholder: 'Name' })    */
'use strict';

let _dialogCount = 0;

const _DIALOG_COLORS = {
  error:   '#c62828',
  warning: '#e65100',
  success: '#2e7d32',
  info:    '#6B2D5B'
};

function _showDialog(mode, message, opts) {
  opts = opts || {};
  const type = opts.type || 'info';
  const accentColor = _DIALOG_COLORS[type] || _DIALOG_COLORS.info;
  const title = opts.title || (mode === 'confirm' ? 'Confirm' : mode === 'prompt' ? 'Input' : '');
  const okText = opts.okText || 'OK';
  const cancelText = opts.cancelText || 'Cancel';

  _dialogCount++;
  const zIndex = 10000 + _dialogCount;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-overlay';
    overlay.style.zIndex = zIndex;

    const showCancel = mode === 'confirm' || mode === 'prompt';
    const inputHTML = mode === 'prompt'
      ? `<input type="text" class="app-dialog-input" id="app-dialog-input"
           placeholder="${(opts.placeholder || '').replace(/"/g, '&quot;')}"
           value="${(opts.defaultValue || '').replace(/"/g, '&quot;')}">`
      : '';

    overlay.innerHTML = `
      <div class="app-dialog-box" style="border-top: 3px solid ${accentColor}">
        ${title ? `<div class="app-dialog-header">${escapeHtml(title)}</div>` : ''}
        <div class="app-dialog-body">${escapeHtml(message)}</div>
        ${inputHTML}
        <div class="app-dialog-actions">
          ${showCancel ? `<button class="btn btn-ghost btn-sm app-dialog-cancel">${escapeHtml(cancelText)}</button>` : ''}
          <button class="btn btn-primary btn-sm app-dialog-ok" style="background:${accentColor};border-color:${accentColor}">${escapeHtml(okText)}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('.app-dialog-ok');
    const cancelBtn = overlay.querySelector('.app-dialog-cancel');
    const inputEl = overlay.querySelector('#app-dialog-input');

    function cleanup() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      _dialogCount--;
    }

    function doOk() {
      cleanup();
      if (mode === 'confirm') resolve(true);
      else if (mode === 'prompt') resolve(inputEl ? inputEl.value : '');
      else resolve(undefined);
    }

    function doCancel() {
      cleanup();
      if (mode === 'confirm') resolve(false);
      else if (mode === 'prompt') resolve(null);
      else resolve(undefined);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
      if (e.key === 'Enter') {
        // Don't steal Enter from other inputs on the page
        if (document.activeElement === inputEl || document.activeElement === okBtn || document.activeElement === overlay) {
          e.preventDefault();
          doOk();
        }
      }
    }

    okBtn.addEventListener('click', doOk);
    if (cancelBtn) cancelBtn.addEventListener('click', doCancel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) doCancel(); });
    document.addEventListener('keydown', onKey);

    // Focus
    if (inputEl) { inputEl.focus(); inputEl.select(); }
    else okBtn.focus();
  });
}

function appAlert(message, opts) {
  return _showDialog('alert', message, opts);
}

function appConfirm(message, opts) {
  return _showDialog('confirm', message, opts);
}

function appPrompt(message, opts) {
  return _showDialog('prompt', message, opts);
}
