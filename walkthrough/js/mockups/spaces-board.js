const STYLE_ID = 'mk-spacesboard-style';

const seedSpaces = [
  { id: 'q3-report', title: 'Send Q3 report to Acme Corp', status: 'captured' },
  { id: 'auth-refactor', title: 'Refactor auth module', status: 'in_progress', agent: true },
  { id: 'offsite-venue', title: 'Book venue for offsite', status: 'captured' },
  { id: 'release-notes', title: 'Write release notes', status: 'done' }
];

const seedActivity = [
  { time: '09:18', icon: '+', text: "Created 'Book venue for offsite'" },
  { time: '09:31', icon: '⚡', text: "Agent run started for 'Refactor auth module'" },
  { time: '09:46', icon: '✓', text: "Completed 'Write release notes'" }
];

const statusMeta = {
  captured: { label: 'captured', icon: '○', action: 'Start', logIcon: '⚡', logVerb: 'Started' },
  in_progress: { label: 'in progress', icon: '⚡', action: 'Complete', logIcon: '✓', logVerb: 'Completed' },
  done: { label: 'done', icon: '✓', action: 'Reopen', logIcon: '↻', logVerb: 'Reopened' }
};

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #widget-spaces-board { width: min(560px, 100%); }
  #widget-spaces-board .spaces-shell { display: grid; gap: 10px; }
  #widget-spaces-board .win { overflow: hidden; }
  #widget-spaces-board .win-body { padding: 12px; }
  #widget-spaces-board .tabs { margin-bottom: 12px; }
  #widget-spaces-board .spaces-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(185px, .85fr); gap: 12px; min-height: 400px; }
  #widget-spaces-board .spaces-list { display: grid; gap: 9px; align-content: start; }
  #widget-spaces-board .space-card { position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 9px; align-items: start; padding: 11px; transition: opacity .18s ease, transform .18s ease, border-color .18s ease; }
  #widget-spaces-board .space-card.done { opacity: .62; }
  #widget-spaces-board .space-card.in_progress { border-color: rgba(120, 160, 255, .45); box-shadow: 0 0 0 1px rgba(120, 160, 255, .08) inset; }
  #widget-spaces-board .status-toggle { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--whim-border); background: rgba(255,255,255,.04); color: var(--whim-text-dim); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; margin-top: 1px; transition: transform .16s ease, background .16s ease, border-color .16s ease; }
  #widget-spaces-board .status-toggle:hover { transform: scale(1.08); border-color: var(--whim-accent); background: rgba(255,255,255,.08); }
  #widget-spaces-board .space-main { min-width: 0; }
  #widget-spaces-board .space-title-row { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
  #widget-spaces-board .space-title { color: var(--whim-text); font-size: 13px; font-weight: 650; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; }
  #widget-spaces-board .space-card.done .space-title { text-decoration: line-through; color: var(--whim-text-dim); }
  #widget-spaces-board .space-meta { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin-top: 7px; }
  #widget-spaces-board .badge { text-transform: none; }
  #widget-spaces-board .badge.captured { background: rgba(255,255,255,.06); color: var(--whim-text-dim); border-color: var(--whim-border); }
  #widget-spaces-board .agent-chip { font-size: 10px; line-height: 1; border: 1px solid rgba(95, 140, 255, .35); color: #b9c8ff; border-radius: 999px; padding: 4px 6px; background: rgba(95, 140, 255, .12); white-space: nowrap; }
  #widget-spaces-board .cycle-hint { color: var(--whim-text-faint); font-size: 10px; }
  #widget-spaces-board .add-space { display: flex; gap: 7px; margin-top: 2px; }
  #widget-spaces-board .add-space .field { flex: 1; min-width: 0; height: 32px; font-size: 12px; }
  #widget-spaces-board .timeline-panel { border: 1px solid var(--whim-border); border-radius: var(--whim-radius); background: rgba(0,0,0,.15); padding: 10px; min-width: 0; }
  #widget-spaces-board .timeline-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
  #widget-spaces-board .timeline-title { font-size: 12px; font-weight: 700; color: var(--whim-text); letter-spacing: .02em; }
  #widget-spaces-board .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--whim-green); box-shadow: 0 0 10px var(--whim-green); }
  #widget-spaces-board .timeline { display: grid; gap: 8px; max-height: 336px; overflow: hidden; }
  #widget-spaces-board .activity { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 8px; align-items: start; padding: 8px; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; background: rgba(255,255,255,.035); }
  #widget-spaces-board .activity-icon { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,.07); color: var(--whim-accent); font-size: 12px; }
  #widget-spaces-board .activity-time { font-family: var(--whim-mono); color: var(--whim-text-faint); font-size: 10px; margin-bottom: 2px; }
  #widget-spaces-board .activity-text { color: var(--whim-text-dim); font-size: 11px; line-height: 1.3; }
  #widget-spaces-board .mockup-toolbar { margin-top: 8px; }
  @media (max-width: 520px) {
    #widget-spaces-board .spaces-layout { grid-template-columns: 1fr; }
    #widget-spaces-board .timeline { max-height: 150px; }
  }
  `;
  document.head.appendChild(s);
}

function cloneSeeds() {
  return {
    spaces: seedSpaces.map(space => ({ ...space })),
    activity: seedActivity.map(entry => ({ ...entry }))
  };
}

function timeNow() {
  return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function nextStatus(status) {
  if (status === 'captured') return 'in_progress';
  if (status === 'in_progress') return 'done';
  return 'captured';
}

export function init(el) {
  injectStyle();

  let state = cloneSeeds();

  el.innerHTML = `
    <div class="spaces-shell">
      <div class="win">
        <div class="win-titlebar">
          <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
          <span class="win-title">whim · Spaces</span>
        </div>
        <div class="win-body">
          <div class="tabs" aria-label="Sections">
            <span class="tab active">Spaces</span>
            <span class="tab">Workers</span>
            <span class="tab">Past</span>
          </div>
          <div class="spaces-layout">
            <div>
              <div class="spaces-list" data-spaces></div>
              <form class="add-space" data-add-form>
                <input class="field" data-add-input maxlength="54" placeholder="+ Capture a new Space" aria-label="New Space title">
                <button class="btn btn-primary btn-sm" type="submit">Add</button>
              </form>
            </div>
            <aside class="timeline-panel" aria-label="Activity timeline">
              <div class="timeline-head"><span class="timeline-title">Activity log</span><span class="live-dot" title="Live"></span></div>
              <div class="timeline" data-timeline></div>
            </aside>
          </div>
        </div>
      </div>
      <div class="mockup-toolbar"><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-reset>↻ Reset</button></div>
    </div>
  `;

  const spacesEl = el.querySelector('[data-spaces]');
  const timelineEl = el.querySelector('[data-timeline]');
  const form = el.querySelector('[data-add-form]');
  const input = el.querySelector('[data-add-input]');
  const reset = el.querySelector('[data-reset]');

  function renderSpaces(changedId) {
    spacesEl.innerHTML = state.spaces.map(space => {
      const meta = statusMeta[space.status];
      const runningChip = space.status === 'in_progress' && space.agent ? '<span class="agent-chip">⚡ running agent</span>' : '';
      return `
        <div class="card space-card ${space.status} ${changedId === space.id ? 'fade-in' : ''}" data-id="${space.id}">
          <button class="status-toggle" data-cycle="${space.id}" aria-label="${meta.action} ${escapeHtml(space.title)}" title="${meta.action}">${meta.icon}</button>
          <div class="space-main">
            <div class="space-title-row"><span class="space-title">${escapeHtml(space.title)}</span></div>
            <div class="space-meta">
              <span class="badge ${space.status === 'captured' ? 'captured' : space.status === 'in_progress' ? 'running' : 'done'}">${space.status === 'in_progress' ? '⚡ ' : ''}${meta.label}</span>
              ${runningChip}
              <span class="cycle-hint">click to ${meta.action.toLowerCase()}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTimeline(newest) {
    timelineEl.innerHTML = state.activity.map((entry, index) => `
      <div class="activity ${newest && index === 0 ? 'slide-in' : ''}">
        <span class="activity-icon">${entry.icon}</span>
        <span><div class="activity-time">${entry.time}</div><div class="activity-text">${escapeHtml(entry.text)}</div></span>
      </div>
    `).join('');
  }

  function log(icon, text) {
    state.activity.unshift({ time: timeNow(), icon, text });
    state.activity = state.activity.slice(0, 8);
    renderTimeline(true);
  }

  function render(changedId) {
    renderSpaces(changedId);
    renderTimeline(false);
  }

  spacesEl.addEventListener('click', event => {
    const button = event.target.closest('[data-cycle]');
    if (!button) return;

    const space = state.spaces.find(item => item.id === button.dataset.cycle);
    if (!space) return;

    const previous = space.status;
    space.status = nextStatus(space.status);
    space.agent = space.status === 'in_progress' && (space.agent || previous === 'captured');

    const meta = statusMeta[previous];
    renderSpaces(space.id);
    log(meta.logIcon, `${meta.logVerb} '${space.title}'`);
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;

    const id = `space-${Date.now()}`;
    state.spaces.unshift({ id, title, status: 'captured' });
    input.value = '';
    renderSpaces(id);
    log('+', `Created '${title}'`);
  });

  reset.addEventListener('click', () => {
    state = cloneSeeds();
    input.value = '';
    render();
  });

  render();
}
