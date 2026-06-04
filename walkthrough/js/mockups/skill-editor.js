// Slide 7 — Skills. A live editor that turns a name, description, and instructions
// into the SKILL.md file whim stores under .agents/skills/.
const STYLE_ID = 'mk-skilleditor-style';
const EMOJIS = ['📦', '📊', '✉️', '📄', '🧩'];
const EXAMPLE = {
  name: 'Weekly Dependency Audit',
  description: 'Check all package manifests for outdated or vulnerable dependencies and summarize findings.',
  body: '- Run the audit tools for each detected package manager.\n- Group findings by severity.\n- Write a short report with recommended next steps.'
};

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  #widget-skill-editor { max-width: 560px; }
  #widget-skill-editor .skill-window { min-height: 500px; }
  #widget-skill-editor .skill-body { display: grid; grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr); gap: 14px; padding: 14px; }
  #widget-skill-editor .skill-form { display: grid; gap: 10px; align-content: start; }
  #widget-skill-editor .skill-name-row { display: flex; align-items: center; gap: 8px; }
  #widget-skill-editor .skill-name-row .field { min-width: 0; flex: 1; }
  #widget-skill-editor .emoji-chip { min-width: 38px; justify-content: center; font-size: 16px; padding: 6px 8px; }
  #widget-skill-editor .skill-textarea { min-height: 145px; resize: none; line-height: 1.35; }
  #widget-skill-editor .skill-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  #widget-skill-editor .skill-toast { min-height: 20px; color: var(--whim-text-dim); font-size: 12px; }
  #widget-skill-editor .skill-toast.ok { color: #8ff0b2; }
  #widget-skill-editor .skill-preview-wrap { min-width: 0; display: grid; gap: 8px; align-content: start; }
  #widget-skill-editor .skill-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  #widget-skill-editor .skill-preview-title { font-size: 12px; color: var(--whim-text-dim); font-weight: 700; }
  #widget-skill-editor .skill-preview { min-height: 314px; max-height: 360px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }
  #widget-skill-editor .skill-path { font-family: var(--whim-mono); font-size: 11px; color: var(--whim-text-faint); white-space: normal; word-break: break-all; }
  #widget-skill-editor .mockup-toolbar { margin-top: 10px; }
  #widget-skill-editor .spacer { flex: 1; }
  `;
  document.head.appendChild(s);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'new-skill';
}

function emojiForName(name) {
  const lower = name.toLowerCase();
  if (lower.includes('audit')) return '📦';
  if (lower.includes('report')) return '📊';
  if (lower.includes('email')) return '✉️';
  if (lower.includes('pdf')) return '📄';
  return '🧩';
}

export function init(el) {
  injectStyle();
  el.innerHTML = `
    <div class="win skill-window">
      <div class="win-titlebar">
        <div class="win-dots"><span class="win-dot red"></span><span class="win-dot amber"></span><span class="win-dot green"></span></div>
        <span class="win-title">whim · New skill</span>
      </div>
      <div class="win-body skill-body">
        <div class="skill-form">
          <div>
            <div class="field-label">Name</div>
            <div class="skill-name-row">
              <input class="field" data-name value="${escapeHtml(EXAMPLE.name)}" aria-label="Skill name">
              <span class="badge emoji-chip" data-emoji>📦</span>
            </div>
          </div>
          <div>
            <div class="field-label">Description</div>
            <input class="field" data-description value="${escapeHtml(EXAMPLE.description)}" aria-label="Skill description">
          </div>
          <div>
            <div class="field-label">Body / instructions</div>
            <textarea class="field skill-textarea" data-body aria-label="Skill instructions">${escapeHtml(EXAMPLE.body)}</textarea>
          </div>
          <div class="skill-actions">
            <button class="btn btn-primary" data-create>Create skill</button>
            <button class="btn btn-ghost btn-sm" data-shuffle>🎲 shuffle</button>
          </div>
          <div class="skill-toast" data-toast></div>
        </div>
        <div class="skill-preview-wrap">
          <div class="skill-preview-head">
            <span class="skill-preview-title">Live SKILL.md preview</span>
            <span class="badge" data-slug>weekly-dependency-audit</span>
          </div>
          <pre class="code-preview skill-preview fade-in" data-preview></pre>
          <div class="c skill-path" data-path>// saved to .agents/skills/weekly-dependency-audit/SKILL.md</div>
        </div>
      </div>
    </div>
    <div class="mockup-toolbar"><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-reset>↻ Reset</button></div>
  `;

  const name = el.querySelector('[data-name]');
  const description = el.querySelector('[data-description]');
  const body = el.querySelector('[data-body]');
  const emoji = el.querySelector('[data-emoji]');
  const preview = el.querySelector('[data-preview]');
  const slugBadge = el.querySelector('[data-slug]');
  const path = el.querySelector('[data-path]');
  const toast = el.querySelector('[data-toast]');
  const create = el.querySelector('[data-create]');
  const shuffle = el.querySelector('[data-shuffle]');
  const reset = el.querySelector('[data-reset]');
  let shuffledEmoji = '';

  function renderPreview() {
    const skillName = name.value || 'Untitled Skill';
    const desc = description.value || 'Reusable instructions for whim.';
    const instructions = body.value || '<add instructions here>';
    const slug = slugify(skillName);
    const pickedEmoji = shuffledEmoji || emojiForName(skillName);

    emoji.textContent = pickedEmoji;
    slugBadge.textContent = slug;
    preview.innerHTML = `<span class="k">---</span>\n<span class="k">name:</span> <span class="s">${escapeHtml(skillName)}</span>\n<span class="k">description:</span> <span class="s">${escapeHtml(desc)}</span>\n<span class="k">---</span>\n\n${escapeHtml(instructions)}`;
    path.textContent = `// saved to .agents/skills/${slug}/SKILL.md`;
    preview.classList.remove('fade-in');
    void preview.offsetWidth;
    preview.classList.add('fade-in');
  }

  function updateFromTyping() {
    shuffledEmoji = '';
    toast.textContent = '';
    toast.classList.remove('ok', 'fade-in');
    renderPreview();
  }

  function resetExample() {
    name.value = EXAMPLE.name;
    description.value = EXAMPLE.description;
    body.value = EXAMPLE.body;
    shuffledEmoji = '';
    toast.textContent = '';
    toast.classList.remove('ok', 'fade-in');
    renderPreview();
  }

  name.addEventListener('input', updateFromTyping);
  description.addEventListener('input', () => { toast.textContent = ''; toast.classList.remove('ok', 'fade-in'); renderPreview(); });
  body.addEventListener('input', () => { toast.textContent = ''; toast.classList.remove('ok', 'fade-in'); renderPreview(); });
  shuffle.addEventListener('click', () => {
    const current = emoji.textContent;
    const next = EMOJIS[(EMOJIS.indexOf(current) + 1) % EMOJIS.length];
    shuffledEmoji = next;
    renderPreview();
  });
  create.addEventListener('click', () => {
    toast.textContent = '✓ Skill created — find it in the Skills tab';
    toast.classList.add('ok', 'fade-in');
  });
  reset.addEventListener('click', resetExample);

  renderPreview();
}
