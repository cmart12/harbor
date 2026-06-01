const STYLE_ID = 'mk-capture-style';
const EXAMPLE_TEXT = 'remind me to send the q3 report to acme corp by friday';

function injectStyle() {
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
    #widget-capture { max-width: 560px; }
    #widget-capture .capture-shell { display: grid; gap: 12px; }
    #widget-capture .capture-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    #widget-capture .hotkey { font-family: var(--whim-mono); font-size: 11px; color: var(--whim-text-faint); border: 1px solid var(--whim-border); border-radius: 8px; padding: 4px 7px; background: rgba(255,255,255,.04); }
    #widget-capture .capture-row { display: flex; align-items: center; gap: 8px; }
    #widget-capture .capture-input { flex: 1; min-width: 0; transition: border-color .2s ease, box-shadow .2s ease, background-position .9s ease; }
    #widget-capture .capture-input.refining { color: #edf1ff; border-color: rgba(138, 155, 255, .72); box-shadow: 0 0 0 1px rgba(138,155,255,.18), 0 0 28px rgba(138,155,255,.18); background-image: linear-gradient(100deg, transparent 0%, rgba(255,255,255,.16) 20%, transparent 40%); background-size: 220% 100%; animation: capture-shimmer .9s ease-in-out infinite; }
    #widget-capture .refine-note { min-height: 20px; margin-top: 9px; font-size: 12px; color: var(--whim-text-dim); opacity: 0; transform: translateY(-3px); transition: opacity .18s ease, transform .18s ease; }
    #widget-capture .refine-note.show { opacity: 1; transform: translateY(0); }
    #widget-capture .spaces-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 2px 0 8px; font-size: 12px; color: var(--whim-text-dim); text-transform: uppercase; letter-spacing: .08em; }
    #widget-capture .spaces-list { display: grid; gap: 9px; max-height: 250px; overflow: hidden; }
    #widget-capture .space-card { padding: 12px; border-left: 3px solid var(--whim-accent); }
    #widget-capture .space-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    #widget-capture .space-title { color: var(--whim-text); font-weight: 700; font-size: 14px; line-height: 1.25; }
    #widget-capture .captured { display: inline-flex; align-items: center; gap: 5px; color: var(--whim-green); font-size: 11px; white-space: nowrap; }
    #widget-capture .captured-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--whim-green); box-shadow: 0 0 12px rgba(69, 214, 154, .55); }
    #widget-capture .space-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
    #widget-capture .due { display: inline-flex; align-items: center; gap: 5px; color: var(--whim-text-dim); font-size: 11px; border: 1px solid var(--whim-border); border-radius: 999px; padding: 3px 8px; background: rgba(255,255,255,.035); }
    #widget-capture .empty { padding: 16px 12px; text-align: center; color: var(--whim-text-faint); border: 1px dashed var(--whim-border); border-radius: var(--whim-radius-sm); font-size: 12px; }
    @keyframes capture-shimmer { 0% { background-position: 130% 0; } 100% { background-position: -130% 0; } }
    `;
    document.head.appendChild(s);
  }
}

function titleCase(words) {
  const small = new Set(['a', 'an', 'and', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
  return words.map((word, index) => {
    const clean = word.trim();
    if (!clean) return '';
    const lower = clean.toLowerCase();
    if (index > 0 && small.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).filter(Boolean).join(' ');
}

function refine(raw) {
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (/q3 report/i.test(normalized) && /acme/i.test(normalized)) {
    return { title: 'Send Q3 report to Acme Corp', client: 'Acme Corp', due: 'Fri' };
  }

  const clientMatch = normalized.match(/(?:to|for|with)\s+([a-z][\w&.-]*(?:\s+(?:corp|co|inc|llc|ltd|labs|studio|group|company))?)/i);
  const dueMatch = normalized.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|sat(?:urday)?|sun(?:day)?|next week)\b/i);
  const compactWords = normalized
    .replace(/\b(remind me to|please|by|before|today|tomorrow|next week)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6);

  return {
    title: compactWords.length ? titleCase(compactWords) : 'Captured Space',
    client: clientMatch ? titleCase(clientMatch[1].split(' ')) : '',
    due: dueMatch ? titleCase([dueMatch[1].slice(0, 3)]) : ''
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function cardTemplate(space) {
  const client = space.client ? `<span class="badge cloud">${escapeHtml(space.client)}</span>` : '';
  const due = space.due ? `<span class="due">◷ ${escapeHtml(space.due)}</span>` : '';
  return `
    <div class="card space-card selectable slide-in">
      <div class="space-top">
        <div class="space-title">${escapeHtml(space.title)}</div>
        <span class="captured"><span class="captured-dot"></span>captured</span>
      </div>
      <div class="space-meta">${client}${due}</div>
    </div>
  `;
}

export function init(el) {
  el.innerHTML = '';
  if (el._mkCaptureTimer) clearTimeout(el._mkCaptureTimer);
  injectStyle();

  el.innerHTML = `
    <div class="capture-shell">
      <div class="win">
        <div class="win-titlebar">
          <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
          <span class="win-title">Copilot Whim</span>
          <span class="win-spacer"></span>
          <span class="hotkey">⌘⇧Space</span>
        </div>
        <div class="win-body">
          <div class="capture-head">
            <div>
              <div class="field-label">Quick capture</div>
              <div style="font-size:12px;color:var(--whim-text-faint);">Turn a raw thought into a clean Space.</div>
            </div>
            <span class="badge waiting">tray app</span>
          </div>
          <div class="capture-row">
            <input class="field capture-input" data-input placeholder="What's on your mind?" value="${EXAMPLE_TEXT}">
            <button class="btn btn-primary" data-capture>Capture ⏎</button>
          </div>
          <div class="refine-note" data-note>✨ Refining intent into title, client, and due date…</div>
        </div>
      </div>

      <div class="spaces-title"><span>Spaces</span><span data-count>0 captured</span></div>
      <div class="spaces-list" data-list><div class="empty" data-empty>No Spaces yet — capture a thought above.</div></div>
      <div class="mockup-toolbar"><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-reset>↻ Reset</button></div>
    </div>
  `;

  const input = el.querySelector('[data-input]');
  const button = el.querySelector('[data-capture]');
  const note = el.querySelector('[data-note]');
  const list = el.querySelector('[data-list]');
  const reset = el.querySelector('[data-reset]');
  const count = el.querySelector('[data-count]');
  let captured = 0;

  function setBusy(isBusy) {
    input.classList.toggle('refining', isBusy);
    note.classList.toggle('show', isBusy);
    button.disabled = isBusy;
    input.disabled = isBusy;
  }

  function updateCount() {
    count.textContent = `${captured} captured`;
  }

  function addSpace(space) {
    const emptyState = list.querySelector('[data-empty]');
    if (emptyState) emptyState.remove();
    list.insertAdjacentHTML('afterbegin', cardTemplate(space));
    captured += 1;
    updateCount();
  }

  function capture() {
    const raw = input.value.trim();
    if (!raw || button.disabled) return;
    setBusy(true);
    el._mkCaptureTimer = setTimeout(() => {
      addSpace(refine(raw));
      input.value = '';
      input.placeholder = 'Capture another thought…';
      setBusy(false);
      input.focus();
    }, 900);
  }

  function doReset() {
    if (el._mkCaptureTimer) clearTimeout(el._mkCaptureTimer);
    setBusy(false);
    captured = 0;
    input.value = EXAMPLE_TEXT;
    input.placeholder = "What's on your mind?";
    list.innerHTML = '<div class="empty" data-empty>No Spaces yet — capture a thought above.</div>';
    updateCount();
  }

  button.addEventListener('click', capture);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      capture();
    }
  });
  reset.addEventListener('click', doReset);
}
