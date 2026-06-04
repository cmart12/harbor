const STYLE_ID = 'mk-personas-style';

const PERSONAS = [
  {
    handle: '@agent',
    emoji: '🤖',
    runLocation: 'Local 💻',
    description: 'General-purpose assistant. Follows your instructions and works on canvas documents through comments.'
  },
  {
    handle: '@editor',
    emoji: '✏️',
    runLocation: 'Local 💻',
    description: 'Document editor. Reads selected text and your comment, researches if needed, edits the text directly, and replies explaining the change.'
  },
  {
    handle: '@dev',
    emoji: '🛠️',
    runLocation: 'Local 💻',
    description: 'Development agent. Makes code changes safely in git worktrees/feature branches, runs tests & linters, and can open a PR.'
  },
  {
    handle: '@pr',
    emoji: '🔀',
    runLocation: 'Copilot Coding Agent 🤖',
    description: "Runs GitHub's Copilot coding agent in the cloud. Works directly on github.com — creates branches and opens pull requests."
  },
  {
    handle: '@cloud',
    emoji: '☁️',
    runLocation: 'Cloud ☁️',
    description: 'Runs in an ephemeral cloud sandbox that is destroyed when the session ends. Great for untrusted builds or disposable experiments.'
  },
  {
    handle: '@secret-agent',
    emoji: '🕵️',
    runLocation: 'Local 💻 (ephemeral)',
    description: 'Private zero-trace agent. No history, checkpoints, or session state is written to disk — nothing remains when it finishes.'
  },
  {
    handle: '@sandbox',
    emoji: '📦',
    runLocation: 'Local 💻 (sandboxed)',
    description: 'Runs with a restricted sandbox policy that limits filesystem and command access for safer autonomous work.'
  }
];

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #widget-personas .personas-layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .8fr); gap: 14px; align-items: stretch; }
  #widget-personas .personas-grid { display: grid; grid-template-columns: repeat( auto-fit, minmax(170px, 1fr) ); gap: 10px; }
  #widget-personas .persona-card { min-height: 118px; display: flex; flex-direction: column; gap: 10px; justify-content: space-between; padding: 14px; cursor: pointer; }
  #widget-personas .persona-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  #widget-personas .persona-emoji { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 14px; background: rgba(255,255,255,.06); border: 1px solid var(--whim-border); font-size: 27px; box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
  #widget-personas .persona-handle { font-family: var(--whim-mono); font-size: 16px; color: var(--whim-text); letter-spacing: -.02em; }
  #widget-personas .persona-location { align-self: flex-start; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #widget-personas .persona-detail { min-height: 100%; border: 1px solid var(--whim-border-strong); border-radius: var(--whim-radius); background: radial-gradient(circle at 20% 0%, rgba(120,115,255,.16), transparent 38%), rgba(255,255,255,.035); padding: 18px; display: grid; align-content: start; gap: 14px; }
  #widget-personas .detail-head { display: flex; gap: 14px; align-items: center; }
  #widget-personas .detail-emoji { width: 68px; height: 68px; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 42px; background: var(--whim-accent-grad); box-shadow: 0 14px 35px rgba(0,0,0,.24); }
  #widget-personas .detail-title { display: grid; gap: 7px; min-width: 0; }
  #widget-personas .detail-handle { font-family: var(--whim-mono); font-size: 28px; color: var(--whim-text); line-height: 1; }
  #widget-personas .detail-description { color: var(--whim-text-dim); font-size: 15px; line-height: 1.55; }
  #widget-personas .detail-hint { border-top: 1px solid var(--whim-border); padding-top: 12px; color: var(--whim-text-faint); font-size: 13px; }
  #widget-personas .detail-hint code { font-family: var(--whim-mono); color: var(--whim-text); background: rgba(0,0,0,.22); border: 1px solid var(--whim-border); border-radius: 7px; padding: 2px 6px; }
  #widget-personas .badge.persona-agent { background: rgba(120,115,255,.16); border-color: rgba(145,140,255,.45); color: #d8d4ff; }
  #widget-personas .badge.persona-local { background: rgba(255,255,255,.055); color: var(--whim-text-dim); }
  #widget-personas .personas-kicker { margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--whim-text-dim); font-size: 13px; }
  @media (max-width: 900px) {
    #widget-personas .personas-layout { grid-template-columns: 1fr; }
    #widget-personas .persona-detail { min-height: auto; }
  }
  `;
  document.head.appendChild(s);
}

function badgeClass(runLocation) {
  if (runLocation.startsWith('Cloud')) return 'cloud';
  if (runLocation.startsWith('Copilot Coding Agent')) return 'cloud persona-agent';
  return 'persona-local';
}

function setSelected(el, persona) {
  el.querySelectorAll('[data-persona-card]').forEach((card) => {
    card.classList.toggle('selected', card.dataset.handle === persona.handle);
  });

  const detail = el.querySelector('[data-persona-detail]');
  detail.classList.remove('fade-in');
  detail.innerHTML = `
    <div class="detail-head">
      <span class="detail-emoji" aria-hidden="true">${persona.emoji}</span>
      <div class="detail-title">
        <span class="detail-handle">${persona.handle}</span>
        <span class="badge ${badgeClass(persona.runLocation)}">${persona.runLocation}</span>
      </div>
    </div>
    <div class="detail-description">${persona.description}</div>
    <div class="detail-hint">Use it: @mention <code>${persona.handle}</code> in a canvas comment</div>
  `;
  requestAnimationFrame(() => detail.classList.add('fade-in'));
}

export function init(el) {
  injectStyle();
  el.innerHTML = `
    <div class="win">
      <div class="win-titlebar">
        <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
        <span class="win-title">whim · Agent personas</span>
      </div>
      <div class="win-body">
        <div class="personas-kicker">
          <span>Built-in @mentionable agents seeded by whim</span>
          <span class="badge done">7 personas</span>
        </div>
        <div class="personas-layout">
          <div class="personas-grid" data-personas-grid></div>
          <div class="persona-detail" data-persona-detail aria-live="polite"></div>
        </div>
      </div>
    </div>
  `;

  const grid = el.querySelector('[data-personas-grid]');
  PERSONAS.forEach((persona) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card selectable persona-card';
    card.dataset.personaCard = '';
    card.dataset.handle = persona.handle;
    card.innerHTML = `
      <span class="persona-card-top">
        <span class="persona-emoji" aria-hidden="true">${persona.emoji}</span>
        <span class="badge ${badgeClass(persona.runLocation)} persona-location">${persona.runLocation}</span>
      </span>
      <span class="persona-handle">${persona.handle}</span>
    `;
    card.addEventListener('click', () => setSelected(el, persona));
    grid.appendChild(card);
  });

  setSelected(el, PERSONAS[0]);
}
