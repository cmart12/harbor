const STYLE_ID = 'mk-standalone-style';
let timers = [];
let workerSeq = 1;

function clearTimers() {
  timers.forEach((timer) => clearTimeout(timer));
  timers = [];
}

function later(fn, delay) {
  const id = setTimeout(() => {
    timers = timers.filter((timer) => timer !== id);
    fn();
  }, delay);
  timers.push(id);
  return id;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;

  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #widget-standalone-agent { width: min(560px, 100%); }
  #widget-standalone-agent .win { height: 520px; overflow: hidden; }
  #widget-standalone-agent .win-body { display: flex; flex-direction: column; gap: 12px; height: calc(100% - 38px); }
  #widget-standalone-agent .top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  #widget-standalone-agent .tabs { flex: 1; min-width: 0; }
  #widget-standalone-agent .composer { display: none; gap: 9px; align-items: end; padding: 10px;
    border: 1px solid rgba(255,255,255,.10); border-radius: 12px; background: rgba(255,255,255,.045); }
  #widget-standalone-agent .composer.open { display: grid; grid-template-columns: 112px 1fr auto; }
  #widget-standalone-agent .composer .field-label { margin-bottom: 4px; }
  #widget-standalone-agent .field { width: 100%; box-sizing: border-box; }
  #widget-standalone-agent .workers { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; padding-right: 2px; }
  #widget-standalone-agent .empty-state { border: 1px dashed rgba(255,255,255,.14); border-radius: 14px; padding: 28px 16px;
    text-align: center; color: var(--whim-text-dim); background: rgba(0,0,0,.12); }
  #widget-standalone-agent .empty-state strong { color: var(--whim-text); display: block; margin-bottom: 5px; }
  #widget-standalone-agent .worker-card { display: grid; gap: 10px; padding: 12px; }
  #widget-standalone-agent .worker-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  #widget-standalone-agent .worker-meta { display: grid; gap: 3px; min-width: 0; }
  #widget-standalone-agent .persona { font-weight: 700; color: var(--whim-text); }
  #widget-standalone-agent .task { color: var(--whim-text-dim); font-size: 12px; line-height: 1.35; }
  #widget-standalone-agent .badge { white-space: nowrap; }
  #widget-standalone-agent .steps { display: grid; gap: 6px; }
  #widget-standalone-agent .step { font-family: var(--whim-mono); font-size: 11px; color: #d7ddff; padding: 7px 8px;
    border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: rgba(0,0,0,.22); }
  #widget-standalone-agent .approval { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 9px;
    border: 1px solid rgba(255,193,7,.28); border-radius: 11px; background: rgba(255,193,7,.08); }
  #widget-standalone-agent .approval-text { color: var(--whim-text); font-size: 12px; }
  #widget-standalone-agent .summary { font-size: 12px; color: var(--whim-green); padding: 8px 9px; border-radius: 10px;
    background: rgba(48,209,88,.10); border: 1px solid rgba(48,209,88,.22); }
  #widget-standalone-agent .stop-note { font-size: 12px; color: var(--whim-red); padding: 8px 9px; border-radius: 10px;
    background: rgba(255,69,58,.10); border: 1px solid rgba(255,69,58,.22); }
  #widget-standalone-agent .mockup-toolbar { margin-top: 8px; }
  `;
  document.head.appendChild(s);
}

function makeBadge(state, label) {
  const badge = document.createElement('span');
  badge.className = `badge ${state}`;
  if (state === 'running') {
    const pulse = document.createElement('span');
    pulse.className = 'dot-pulse';
    badge.append(pulse, document.createTextNode(` ${label}`));
  } else {
    badge.textContent = label;
  }
  return badge;
}

function setBadge(card, state, label) {
  const slot = card.querySelector('[data-badge-slot]');
  slot.replaceChildren(makeBadge(state, label));
}

function addStep(card, text) {
  const step = document.createElement('div');
  step.className = 'step fade-in';
  step.textContent = text;
  card.querySelector('[data-steps]').appendChild(step);
}

function showApproval(card, resume) {
  setBadge(card, 'waiting', 'waiting — needs approval');

  const bar = document.createElement('div');
  bar.className = 'approval fade-in';

  const action = document.createElement('span');
  action.className = 'approval-text';
  action.textContent = 'Permission requested: Run npm audit fix';

  const approve = document.createElement('button');
  approve.className = 'btn btn-green btn-sm';
  approve.textContent = 'Approve';

  const deny = document.createElement('button');
  deny.className = 'btn btn-red btn-sm';
  deny.textContent = 'Deny';

  bar.append(action, approve, deny);
  card.appendChild(bar);

  approve.addEventListener('click', () => {
    bar.remove();
    setBadge(card, 'running', 'running');
    resume();
  });

  deny.addEventListener('click', () => {
    bar.remove();
    setBadge(card, 'failed', '✗ stopped');
    const note = document.createElement('div');
    note.className = 'stop-note fade-in';
    note.textContent = 'Stopped before applying fixes.';
    card.appendChild(note);
  });
}

function startWorker(list, empty, persona, taskText) {
  empty.hidden = true;

  const card = document.createElement('div');
  card.className = 'card worker-card slide-in';
  card.innerHTML = `
    <div class="worker-head">
      <div class="worker-meta">
        <span class="persona"></span>
        <span class="task"></span>
      </div>
      <span data-badge-slot></span>
    </div>
    <div class="steps" data-steps></div>
  `;
  card.querySelector('.persona').textContent = `${persona} · worker #${workerSeq++}`;
  card.querySelector('.task').textContent = taskText;
  card.querySelector('[data-badge-slot]').appendChild(makeBadge('running', 'running'));
  list.prepend(card);

  const openingSteps = [
    '🔧 bash — npm audit --json',
    '📖 read — package-lock.json',
    '🔧 bash — npm outdated'
  ];
  const closingSteps = [
    '🔧 bash — npm audit fix',
    '📖 write — package-lock.json'
  ];

  openingSteps.forEach((step, index) => later(() => addStep(card, step), 620 + index * 690));
  later(() => showApproval(card, () => {
    closingSteps.forEach((step, index) => later(() => addStep(card, step), 420 + index * 670));
    later(() => {
      setBadge(card, 'done', '✓ completed');
      const summary = document.createElement('div');
      summary.className = 'summary fade-in';
      summary.textContent = 'Found 3 advisories; patched 2, 1 needs a major bump.';
      card.appendChild(summary);
    }, 1900);
  }), 2700);
}

export function init(el) {
  clearTimers();
  injectStyle();
  workerSeq = 1;

  el.innerHTML = `
    <div class="win">
      <div class="win-titlebar">
        <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
        <span class="win-title">Copilot Whim · Workers</span>
      </div>
      <div class="win-body">
        <div class="top-row">
          <div class="tabs"><button class="tab">Spaces</button><button class="tab active">Workers</button><button class="tab">Past</button></div>
          <button class="btn btn-primary" data-new-agent>+ New Agent</button>
        </div>
        <div class="composer" data-composer>
          <label><div class="field-label">Persona</div><select class="field" data-persona><option>@agent</option><option>@dev 🛠️</option><option>@cloud ☁️</option></select></label>
          <label><div class="field-label">Prompt</div><input class="field" data-prompt value="Audit our dependencies for known vulnerabilities and summarize."></label>
          <button class="btn btn-primary" data-start>Start</button>
        </div>
        <div class="workers" data-workers>
          <div class="empty-state" data-empty><strong>No canvas needed.</strong>Kick off a standalone worker and watch live tool steps stream here.</div>
        </div>
      </div>
    </div>
    <div class="mockup-toolbar"><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-reset>↻ Reset</button></div>
  `;

  const composer = el.querySelector('[data-composer]');
  const newAgent = el.querySelector('[data-new-agent]');
  const start = el.querySelector('[data-start]');
  const persona = el.querySelector('[data-persona]');
  const prompt = el.querySelector('[data-prompt]');
  const list = el.querySelector('[data-workers]');
  const empty = el.querySelector('[data-empty]');
  const reset = el.querySelector('[data-reset]');

  newAgent.addEventListener('click', () => {
    composer.classList.toggle('open');
    if (composer.classList.contains('open')) prompt.focus();
  });

  start.addEventListener('click', () => {
    const text = prompt.value.trim() || 'Audit our dependencies for known vulnerabilities and summarize.';
    composer.classList.remove('open');
    startWorker(list, empty, persona.value, text);
  });

  reset.addEventListener('click', () => init(el));
}
