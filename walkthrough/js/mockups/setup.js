// Slide 2 — Setup process. A fake first-run flow: choose a workspace, then the
// tray icon + Whim window appear with the global hotkey hint.
const STYLE_ID = 'mk-setup-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #widget-setup .setup-stage { display: grid; gap: 12px; }
  #widget-setup .tray { display: flex; align-items: center; gap: 8px; justify-content: flex-end;
    font-size: 12px; color: var(--whim-text-dim); height: 22px; }
  #widget-setup .tray-icon { width: 18px; height: 18px; border-radius: 5px; background: var(--whim-accent-grad);
    display: inline-flex; align-items: center; justify-content: center; font-size: 11px; opacity: 0; transition: opacity .4s ease; }
  #widget-setup .tray-icon.show { opacity: 1; }
  #widget-setup .ws-row { display: flex; gap: 8px; align-items: center; }
  #widget-setup .ws-path { flex: 1; font-family: var(--whim-mono); font-size: 12px; color: var(--whim-text-dim);
    background: rgba(0,0,0,.28); border: 1px dashed var(--whim-border-strong); border-radius: 9px; padding: 9px 11px; }
  #widget-setup .ws-path.set { color: #cdd6ff; border-style: solid; }
  #widget-setup .whim-window { display: none; }
  #widget-setup .whim-window.show { display: block; }
  #widget-setup .hk { display: flex; gap: 6px; align-items: center; justify-content: center; padding: 16px 12px;
    color: var(--whim-text-dim); font-size: 13px; }
  #widget-setup .check { color: var(--whim-green); }
  `;
  document.head.appendChild(s);
}

export function init(el) {
  injectStyle();
  el.innerHTML = `
    <div class="setup-stage">
      <div class="tray"><span>system tray</span><span class="tray-icon" data-tray>⚡</span></div>
      <div class="win">
        <div class="win-titlebar">
          <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
          <span class="win-title">Copilot Whim · First run</span>
        </div>
        <div class="win-body">
          <div class="field-label">Workspace folder</div>
          <div class="ws-row">
            <span class="ws-path" data-path>No folder selected</span>
            <button class="btn btn-primary" data-choose>Choose…</button>
          </div>
          <div class="whim-window" data-ready>
            <div class="hk"><span class="check">✓</span> Ready — press
              <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> anytime</div>
          </div>
        </div>
      </div>
    </div>
    <div class="mockup-toolbar"><span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" data-reset>↻ Replay</button></div>
  `;

  const path = el.querySelector('[data-path]');
  const choose = el.querySelector('[data-choose]');
  const ready = el.querySelector('[data-ready]');
  const tray = el.querySelector('[data-tray]');
  const reset = el.querySelector('[data-reset]');

  function doChoose() {
    path.textContent = '~/work/whim-workspace';
    path.classList.add('set');
    tray.classList.add('show');
    ready.classList.add('show', 'slide-in');
    choose.disabled = true;
  }
  function doReset() {
    path.textContent = 'No folder selected';
    path.classList.remove('set');
    tray.classList.remove('show');
    ready.classList.remove('show', 'slide-in');
    choose.disabled = false;
  }
  choose.addEventListener('click', doChoose);
  reset.addEventListener('click', doReset);
}
