const STYLE_ID = 'mk-canvascomment-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #widget-canvas-comment { width: min(560px, 100%); }
  #widget-canvas-comment * { box-sizing: border-box; }
  #widget-canvas-comment .canvas-stage { display: grid; gap: 10px; }
  #widget-canvas-comment .hint { display: flex; align-items: center; gap: 8px; min-height: 26px;
    color: var(--whim-text-dim); font-size: 12px; letter-spacing: .01em; }
  #widget-canvas-comment .hint strong { color: var(--whim-text); font-weight: 650; }
  #widget-canvas-comment .canvas-wrap { position: relative; }
  #widget-canvas-comment .win { overflow: visible; }
  #widget-canvas-comment .win-body { position: relative; min-height: 432px; padding: 14px; overflow: visible; }
  #widget-canvas-comment .md-page { min-height: 240px; padding: 14px 15px; border-radius: 13px;
    background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.018));
    border: 1px solid var(--whim-border); color: var(--whim-text-dim); font-size: 13px; line-height: 1.62; }
  #widget-canvas-comment .md-line { margin: 0 0 9px; }
  #widget-canvas-comment .md-head { color: var(--whim-text); font-weight: 700; font-size: 15px; }
  #widget-canvas-comment .md-bullet { padding-left: 13px; }
  #widget-canvas-comment .target-sentence { position: relative; border-radius: 7px; padding: 2px 4px; margin: -2px -4px;
    cursor: text; transition: background .18s ease, color .18s ease, box-shadow .18s ease; }
  #widget-canvas-comment .target-sentence:hover { background: rgba(124, 92, 255, .13); color: var(--whim-text); }
  #widget-canvas-comment .target-sentence.selected { background: rgba(124, 92, 255, .24); color: #fff;
    box-shadow: inset 0 -1px 0 rgba(255,255,255,.18), 0 0 0 1px rgba(124,92,255,.28); }
  #widget-canvas-comment .target-sentence.updated { background: rgba(39, 201, 63, .18); box-shadow: 0 0 0 1px rgba(39,201,63,.24); }
  #widget-canvas-comment .floating-comment { position: absolute; z-index: 5; top: 106px; right: 22px;
    box-shadow: 0 12px 30px rgba(0,0,0,.28); transform: translateY(4px); opacity: 0; pointer-events: none;
    transition: opacity .18s ease, transform .18s ease; }
  #widget-canvas-comment .floating-comment.show { opacity: 1; pointer-events: auto; transform: translateY(0); }
  #widget-canvas-comment .composer { position: absolute; z-index: 4; right: 16px; top: 138px; width: min(310px, calc(100% - 32px));
    padding: 12px; border: 1px solid var(--whim-border-strong); box-shadow: 0 18px 45px rgba(0,0,0,.35);
    background: rgba(26, 29, 45, .96); backdrop-filter: blur(10px); display: none; }
  #widget-canvas-comment .composer.show { display: block; }
  #widget-canvas-comment .quote { border-left: 3px solid var(--whim-accent); padding: 7px 9px; margin-bottom: 9px;
    color: var(--whim-text-dim); background: rgba(124,92,255,.09); border-radius: 0 9px 9px 0; font-size: 12px; line-height: 1.35; }
  #widget-canvas-comment .field { width: 100%; min-height: 78px; resize: none; font: 12px/1.45 var(--whim-font); }
  #widget-canvas-comment .composer-actions { position: relative; display: flex; align-items: center; gap: 7px; margin-top: 9px; }
  #widget-canvas-comment .persona-menu { position: absolute; left: 0; bottom: 36px; width: 170px; padding: 6px;
    border: 1px solid var(--whim-border-strong); border-radius: 11px; background: var(--whim-surface-2);
    box-shadow: 0 14px 32px rgba(0,0,0,.34); display: none; }
  #widget-canvas-comment .persona-menu.show { display: grid; gap: 3px; }
  #widget-canvas-comment .persona-option { border: 0; width: 100%; display: flex; align-items: center; gap: 8px; text-align: left;
    padding: 7px 8px; border-radius: 8px; color: var(--whim-text); background: transparent; cursor: pointer; font: 12px var(--whim-font); }
  #widget-canvas-comment .persona-option:hover, #widget-canvas-comment .persona-option.suggested { background: rgba(124,92,255,.16); }
  #widget-canvas-comment .thread { margin-top: 12px; display: grid; gap: 8px; }
  #widget-canvas-comment .comment { padding: 10px 11px; border-radius: 12px; border: 1px solid var(--whim-border);
    background: rgba(255,255,255,.035); }
  #widget-canvas-comment .comment-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  #widget-canvas-comment .author { color: var(--whim-text); font-weight: 650; font-size: 12px; }
  #widget-canvas-comment .comment p { margin: 0; color: var(--whim-text-dim); font-size: 12px; line-height: 1.45; }
  #widget-canvas-comment .agent-line { display: flex; align-items: center; gap: 7px; color: var(--whim-text-dim); font-size: 12px; }
  #widget-canvas-comment .spacer { flex: 1; }
  `;
  document.head.appendChild(s);
}

function setStep(el, step, text) {
  const hint = el.querySelector('[data-hint]');
  hint.innerHTML = `<strong>Step ${step} of 4</strong> — ${text}`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[ch]);
}

export function init(el) {
  injectStyle();
  if (el._canvasCommentTimer) window.clearTimeout(el._canvasCommentTimer);
  el.innerHTML = `
    <div class="canvas-stage">
      <div class="hint" data-hint><strong>Step 1 of 4</strong> — select the text</div>
      <div class="canvas-wrap">
        <div class="win">
          <div class="win-titlebar">
            <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
            <span class="win-title">Acme onboarding · canvas</span>
          </div>
          <div class="win-body">
            <div class="md-page" aria-label="Markdown canvas">
              <p class="md-line md-head"># Acme onboarding launch</p>
              <p class="md-line">Goal: help new Acme admins invite teammates and complete their first workflow in week one.</p>
              <p class="md-line md-bullet">- Welcome note should feel personal, concise, and grounded in Acme's rollout plan.</p>
              <p class="md-line"><span data-target class="target-sentence" role="button" tabindex="0">The onboarding email is a bit generic and could be warmer.</span></p>
              <p class="md-line md-bullet">- Include a clear next step: connect the workspace, then run the guided checklist.</p>
            </div>
            <button class="btn btn-sm floating-comment" data-comment>💬 Comment</button>
            <div class="card composer" data-composer>
              <div class="quote">“<span data-quote>The onboarding email is a bit generic and could be warmer.</span>”</div>
              <textarea class="field" data-text>Make this warmer and more specific to Acme.</textarea>
              <div class="composer-actions">
                <button class="btn btn-ghost btn-sm" data-mention>@ mention</button>
                <button class="btn btn-primary btn-sm" data-send>Send</button>
                <div class="persona-menu" data-menu>
                  <button class="persona-option" data-persona="@agent">🤖 @agent <span class="spacer"></span></button>
                  <button class="persona-option suggested" data-persona="@editor">✏️ @editor <span class="badge waiting">suggested</span></button>
                  <button class="persona-option" data-persona="@dev">🛠️ @dev <span class="spacer"></span></button>
                </div>
              </div>
            </div>
            <div class="thread" data-thread></div>
          </div>
        </div>
      </div>
      <div class="mockup-toolbar"><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-reset>↻ Reset</button></div>
    </div>
  `;

  const target = el.querySelector('[data-target]');
  const commentButton = el.querySelector('[data-comment]');
  const composer = el.querySelector('[data-composer]');
  const textarea = el.querySelector('[data-text]');
  const mentionButton = el.querySelector('[data-mention]');
  const menu = el.querySelector('[data-menu]');
  const sendButton = el.querySelector('[data-send]');
  const thread = el.querySelector('[data-thread]');
  let selectedPersona = '@editor';
  let done = false;
  let timer = null;

  function selectText() {
    if (done) return;
    target.classList.add('selected');
    commentButton.classList.add('show');
    setStep(el, 2, 'open a comment on the selection');
  }

  function openComposer() {
    composer.classList.add('show', 'slide-in');
    commentButton.classList.remove('show');
    textarea.focus();
    setStep(el, 3, 'mention the editor persona');
  }

  function showMenu() {
    menu.classList.add('show');
    setStep(el, 3, 'choose @editor from the persona list');
  }

  function insertPersona(persona) {
    selectedPersona = persona;
    const withoutMentions = textarea.value.replace(/@(agent|editor|dev)\s*/g, '').trim();
    textarea.value = `${persona} ${withoutMentions}`;
    menu.classList.remove('show');
    textarea.focus();
    setStep(el, 4, 'send the agent comment');
  }

  function sendComment() {
    if (done) return;
    done = true;
    menu.classList.remove('show');
    composer.classList.remove('show');
    setStep(el, 4, `${selectedPersona} is running on the comment`);
    thread.innerHTML = `
      <div class="comment fade-in">
        <div class="comment-head"><span class="author">You</span><span class="badge running"><span class="dot-pulse"></span> running</span></div>
        <p>${escapeHtml(textarea.value.trim() || `${selectedPersona} Make this warmer and more specific to Acme.`)}</p>
        <div class="agent-line" data-agent-line><span class="badge running"><span class="dot-pulse"></span> running</span><span>${selectedPersona} is working…</span></div>
      </div>
    `;
    sendButton.disabled = true;
    timer = window.setTimeout(() => {
      el._canvasCommentTimer = null;
      const badge = thread.querySelector('.comment-head .badge');
      const agentLine = thread.querySelector('[data-agent-line]');
      if (badge) {
        badge.className = 'badge done';
        badge.textContent = '✓ done';
      }
      if (agentLine) {
        agentLine.innerHTML = '<span class="badge done">✓ done</span><span>@editor finished</span>';
      }
      target.textContent = "Acme's onboarding email now welcomes admins by name, highlights their rollout goals, and invites them to start the guided checklist.";
      target.classList.add('updated', 'fade-in');
      thread.insertAdjacentHTML('beforeend', `
        <div class="comment slide-in">
          <div class="comment-head"><span class="author">✏️ @editor</span><span class="badge done">✓ done</span></div>
          <p>Rewrote the sentence to reference Acme's onboarding goals and use a warmer tone.</p>
        </div>
      `);
      setStep(el, 4, 'agent replied and updated the canvas');
    }, 1400);
    el._canvasCommentTimer = timer;
  }

  target.addEventListener('click', selectText);
  target.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectText();
    }
  });
  commentButton.addEventListener('click', openComposer);
  mentionButton.addEventListener('click', showMenu);
  textarea.addEventListener('input', () => {
    if (textarea.value.includes('@')) showMenu();
  });
  menu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-persona]');
    if (option) insertPersona(option.dataset.persona);
  });
  sendButton.addEventListener('click', sendComment);
  el.querySelector('[data-reset]').addEventListener('click', () => {
    if (timer) window.clearTimeout(timer);
    init(el);
  });
}
