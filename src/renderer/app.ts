interface RecurrenceResult {
  should_recur: boolean;
  reasoning: string;
  next_due: string | null;
  next_due_utc: string | null;
}

interface RecallMatch {
  intent_id: string;
  description: string;
  completed_at: string | null;
  confidence: number;
}

interface IntentAPI {
  create(input: { body: string }): Promise<Intent>;
  list(): Promise<Intent[]>;
  update(id: string, updates: Record<string, unknown>): Promise<Intent>;
  delete(id: string): Promise<boolean>;
  dismissRecurrence(id: string): Promise<boolean>;
  transcribe(audioData: number[]): Promise<string>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listModels(): Promise<{ id: string; name?: string }[]>;
  listEvents(limit?: number): Promise<any[]>;
  resolveDate(dateText: string): Promise<{ due_at: string; due_at_utc: string | null }>;
  classifyInput(text: string): Promise<{ type: 'intent' | 'query'; query_answer?: string }>;
  launchSession(intentId: string): Promise<{ success: boolean; error?: string; sessionId?: string }>;
  getActiveSessions(): Promise<string[]>;
  selectWorkspace(): Promise<{ selected: boolean; path: string | null }>;
  readCanvas(intentId: string): Promise<{ content: string; error?: string }>;
  writeCanvas(intentId: string, content: string): Promise<{ success?: boolean; error?: string }>;
  closeCanvas(intentId: string, content: string): Promise<void>;
  searchIntents(query: string): Promise<Intent[]>;
  pasteFile(intentId: string, filename: string, dataArray: number[]): Promise<{ success?: boolean; relativePath?: string; filename?: string; error?: string }>;
  hideWindow(): void;
  onWindowShown(callback: () => void): void;
  onIntentProcessed(callback: (id: string) => void): void;
  onRecurrenceResult(callback: (intentId: string, result: RecurrenceResult) => void): void;
  onRecurrenceApplied(callback: (intentId: string) => void): void;
  onRecallHint(callback: (intentId: string, match: RecallMatch) => void): void;
}

interface Attachment {
  type: 'url' | 'file';
  name: string;
  url: string;
  relativePath?: string;
  mimeType?: string;
}

interface Intent {
  id: string;
  description: string;
  body: string | null;
  raw_text: string | null;
  client: string | null;
  due_at: string | null;
  due_at_utc: string | null;
  recurrence: string | null;
  completed_at: string | null;
  folder: string | null;
  session_id: string | null;
  attachments: Attachment[];
  status: 'captured' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

declare const intentAPI: IntentAPI;

const descInput = document.getElementById('description-input') as HTMLTextAreaElement;
const form = document.getElementById('capture-form') as HTMLFormElement;
const listEl = document.getElementById('intent-list') as HTMLDivElement;
const countEl = document.getElementById('intent-count') as HTMLSpanElement;
const statusBar = document.getElementById('status-bar') as HTMLDivElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsView = document.getElementById('settings-view') as HTMLDivElement;
const settingsBack = document.getElementById('settings-back') as HTMLButtonElement;
const mainView = document.getElementById('main-view') as HTMLDivElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const recordingIndicator = document.getElementById('recording-indicator') as HTMLDivElement;
const themeLightBtn = document.getElementById('theme-light') as HTMLButtonElement;
const themeDarkBtn = document.getElementById('theme-dark') as HTMLButtonElement;
const timelineBtn = document.getElementById('timeline-btn') as HTMLButtonElement;
const timelineView = document.getElementById('timeline-view') as HTMLDivElement;
const timelineBack = document.getElementById('timeline-back') as HTMLButtonElement;
const timelineContent = document.getElementById('timeline-content') as HTMLDivElement;

let intents: Intent[] = [];
// Track intents being processed by LLM
const processingIntents = new Set<string>();
// Track intents with active running terminal sessions
let activeSessionIntents = new Set<string>();
// Current filter
let currentFilter: 'all' | 'scheduled' | 'unscheduled' | 'past' = 'all';
const filterBar = document.getElementById('filter-bar') as HTMLDivElement;
const queryResult = document.getElementById('query-result') as HTMLDivElement;
const focusBanner = document.getElementById('focus-banner') as HTMLDivElement;
const focusDesc = document.getElementById('focus-desc') as HTMLDivElement;
const focusMeta = document.getElementById('focus-meta') as HTMLDivElement;
const focusDone = document.getElementById('focus-done') as HTMLButtonElement;
const focusClear = document.getElementById('focus-clear') as HTMLButtonElement;
let focusedIntentId: string | null = null;
let selectedIndex = -1;
let displayedIntents: Intent[] = [];
let searchResults: Intent[] | null = null;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let searchMode = false;

// ── Status bar helpers ──────────────────────────────────
function showStatus(msg: string, isError = false): void {
  statusBar.textContent = msg;
  statusBar.classList.remove('hidden', 'error');
  if (isError) statusBar.classList.add('error');
}

function hideStatus(): void {
  statusBar.classList.add('hidden');
}

// ── Filter bar ──────────────────────────────────────────
filterBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.filter-btn') as HTMLElement;
  if (!btn) return;
  const filter = btn.dataset.filter as typeof currentFilter;
  if (filter === currentFilter) return;

  currentFilter = filter;
  filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
});

// ── Settings view ───────────────────────────────────────
function showSettings(): void {
  mainView.classList.add('hidden');
  settingsView.classList.remove('hidden');
  settingsBtn.classList.add('active');
  loadModels();
  loadWorkspaceSetting();
  loadThemeSetting();
}

function hideSettings(): void {
  settingsView.classList.add('hidden');
  mainView.classList.remove('hidden');
  settingsBtn.classList.remove('active');
  descInput.focus();
}

settingsBtn.addEventListener('click', showSettings);
settingsBack.addEventListener('click', hideSettings);

modelSelect.addEventListener('change', async () => {
  const model = modelSelect.value;
  if (model) {
    await intentAPI.setSetting('model', model);
    showStatus(`✓ Model set to ${model}`);
    setTimeout(hideStatus, 2000);
  }
});

async function loadModels(): Promise<void> {
  const currentModel = await intentAPI.getSetting('model');
  try {
    const models = await intentAPI.listModels();
    modelSelect.innerHTML = '';

    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No models available</option>';
      return;
    }

    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      if (m.id === currentModel) opt.selected = true;
      modelSelect.appendChild(opt);
    }

    // If no saved model, select the first one
    if (!currentModel && models.length > 0) {
      modelSelect.value = models[0].id;
    }
  } catch {
    modelSelect.innerHTML = '<option value="">Failed to load models</option>';
  }
}

async function loadSettings(): Promise<void> {
  // Apply saved theme on startup
  const theme = await intentAPI.getSetting('theme');
  applyTheme(theme || 'light');
}

// ── Theme ───────────────────────────────────────────────
function applyTheme(theme: string): void {
  document.body.classList.toggle('dark', theme === 'dark');
  themeLightBtn.classList.toggle('active', theme !== 'dark');
  themeDarkBtn.classList.toggle('active', theme === 'dark');
}

async function loadThemeSetting(): Promise<void> {
  const theme = await intentAPI.getSetting('theme');
  applyTheme(theme || 'light');
}

themeLightBtn.addEventListener('click', async () => {
  await intentAPI.setSetting('theme', 'light');
  applyTheme('light');
});

themeDarkBtn.addEventListener('click', async () => {
  await intentAPI.setSetting('theme', 'dark');
  applyTheme('dark');
});

async function loadWorkspaceSetting(): Promise<void> {
  const ws = await intentAPI.getSetting('workspace_root');
  updateWorkspaceDisplay(ws);
}

// ── Voice Input (spacebar-triggered) ────────────────────
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let isRecording = false;
let audioStream: MediaStream | null = null;

async function startRecording(): Promise<void> {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      audioStream?.getTracks().forEach(t => t.stop());
      audioStream = null;

      if (audioChunks.length === 0) {
        showStatus('No audio captured', true);
        setInputState('idle');
        return;
      }

      setInputState('transcribing');
      showStatus('✨ Transcribing...');

      try {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const float32 = await blobToFloat32(blob);
        const text = await intentAPI.transcribe(Array.from(float32));

        if (text) {
          descInput.value = text;
          showStatus('✓ Voice captured — press Enter to save');
          setTimeout(hideStatus, 3000);
        } else {
          showStatus('No speech detected', true);
        }
      } catch (err) {
        console.error('Transcription failed:', err);
        showStatus('Transcription failed', true);
      } finally {
        setInputState('idle');
      }
    };

    isRecording = true;
    setInputState('recording');
    descInput.value = '';
    showStatus('🎤 Listening... press space to stop');
    mediaRecorder.start();
  } catch (err: any) {
    console.error('Microphone error:', err);
    if (err.name === 'NotAllowedError') {
      showStatus('Microphone access denied', true);
    } else {
      showStatus(`Mic error: ${err.message}`, true);
    }
  }
}

function stopRecording(): void {
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

function setInputState(state: 'idle' | 'recording' | 'transcribing'): void {
  descInput.classList.remove('recording', 'transcribing');
  recordingIndicator.classList.add('hidden');

  switch (state) {
    case 'recording':
      descInput.classList.add('recording');
      descInput.placeholder = 'Listening... press space to stop';
      recordingIndicator.classList.remove('hidden');
      break;
    case 'transcribing':
      descInput.classList.add('transcribing');
      descInput.placeholder = 'Transcribing...';
      break;
    default:
      descInput.placeholder = searchMode ? '🔍 Search intents...' : 'Capture an intent...';
  }
}

async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  audioCtx.close();
  return channelData;
}

// Auto-resize textarea
function autoResize(): void {
  descInput.style.height = 'auto';
  const maxHeight = 120; // ~5 lines
  descInput.style.height = Math.min(descInput.scrollHeight, maxHeight) + 'px';
  descInput.style.overflowY = descInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

descInput.addEventListener('input', autoResize);

// Live search: filter intents when in search mode
descInput.addEventListener('input', () => {
  if (searchTimeout) clearTimeout(searchTimeout);

  if (!searchMode) {
    if (searchResults !== null) {
      searchResults = null;
      selectedIndex = -1;
      render();
    }
    return;
  }

  const query = descInput.value.trim();
  if (!query) {
    searchResults = null;
    selectedIndex = -1;
    render();
    return;
  }

  searchTimeout = setTimeout(async () => {
    searchResults = await intentAPI.searchIntents(query);
    selectedIndex = -1;
    render();
  }, 250);
});

function enterSearchMode(): void {
  searchMode = true;
  descInput.classList.add('search-mode');
  descInput.placeholder = '🔍 Search intents...';
  descInput.value = '';
  descInput.style.height = 'auto';
  searchResults = null;
  selectedIndex = -1;
  render();
  descInput.focus();
}

function exitSearchMode(): void {
  searchMode = false;
  descInput.classList.remove('search-mode');
  descInput.placeholder = 'Capture an intent...';
  descInput.value = '';
  descInput.style.height = 'auto';
  searchResults = null;
  selectedIndex = -1;
  render();
  descInput.focus();
}

// Spacebar handling on the textarea
descInput.addEventListener('keydown', (e) => {
  // Shift+Tab toggles between search and intent mode
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    if (searchMode) exitSearchMode();
    else enterSearchMode();
    return;
  }

  // Down arrow jumps to the intent list
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    if (displayedIntents.length > 0) {
      selectedIndex = 0;
      updateSelection();
      descInput.blur();
    }
    return;
  }

  // In search mode, Enter selects the first result instead of creating
  if (e.key === 'Enter' && !e.shiftKey && searchMode) {
    e.preventDefault();
    if (displayedIntents.length > 0) {
      openCanvas(displayedIntents[0].id);
    }
    return;
  }

  // Enter submits by default; Shift+Enter inserts newline
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
    return;
  }

  if (e.key === ' ') {
    if (isRecording) {
      e.preventDefault();
      stopRecording();
      return;
    }
    if (descInput.value === '') {
      e.preventDefault();
      startRecording();
      return;
    }
  }
});

// ── Text refinement animation ───────────────────────────
function animateTextReplace(el: HTMLElement, oldText: string, newText: string, duration = 600): Promise<void> {
  return new Promise(resolve => {
    const startTime = performance.now();
    const maxLen = Math.max(oldText.length, newText.length);

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const revealedCount = Math.floor(eased * newText.length);

      let html = '';
      for (let i = 0; i < newText.length; i++) {
        if (i < revealedCount) {
          // Already placed — check if it just appeared (within last few chars of the wave)
          const justRevealed = i >= revealedCount - 3;
          if (justRevealed) {
            html += `<span class="letter-glow">${newText[i] === ' ' ? '&nbsp;' : escapeHtmlChar(newText[i])}</span>`;
          } else {
            html += newText[i] === ' ' ? ' ' : escapeHtmlChar(newText[i]);
          }
        } else {
          // Not yet revealed — show old char or nothing
          if (i < oldText.length) {
            html += `<span class="letter-fading">${oldText[i] === ' ' ? '&nbsp;' : escapeHtmlChar(oldText[i])}</span>`;
          }
        }
      }

      el.innerHTML = html;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = newText;
        el.classList.add('refined');
        setTimeout(() => el.classList.remove('refined'), 600);
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

function escapeHtmlChar(ch: string): string {
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  if (ch === '&') return '&amp;';
  if (ch === '"') return '&quot;';
  return ch;
}

async function animateRefinement(intentId: string): Promise<void> {
  const oldIntent = intents.find(i => i.id === intentId);
  const oldText = oldIntent?.description || '';

  const updatedIntents = await intentAPI.list();
  const newIntent = updatedIntents.find(i => i.id === intentId);

  if (!newIntent || oldText === newIntent.description) {
    intents = updatedIntents;
    render();
    return;
  }

  const itemEl = listEl.querySelector(`[data-id="${intentId}"]`);
  const descEl = itemEl?.querySelector('.intent-desc') as HTMLElement | null;

  if (!descEl) {
    intents = updatedIntents;
    render();
    return;
  }

  itemEl?.classList.remove('processing');
  const badge = itemEl?.querySelector('.processing-badge');
  if (badge) badge.remove();

  await animateTextReplace(descEl, oldText, newIntent.description);

  // Fade in new meta
  const metaEl = itemEl?.querySelector('.intent-meta') as HTMLElement | null;
  if (metaEl) {
    const dueInfo = formatDueDate(newIntent.due_at_utc, newIntent.due_at);
    const hasDue = dueInfo.text !== '';
    const isRecurring = !!newIntent.recurrence;
    let metaHtml = '';
    if (newIntent.client) metaHtml += `<span class="meta-fade-in">👤 ${escapeHtml(newIntent.client)}</span>`;
    if (hasDue) metaHtml += `<span class="meta-fade-in due-badge ${dueInfo.overdue ? 'overdue' : ''}">📅 ${escapeHtml(dueInfo.text)}</span>`;
    if (isRecurring) metaHtml += `<span class="meta-fade-in recurring-badge">↻</span>`;
    metaHtml += `<span>${timeAgo(newIntent.updated_at)}</span>`;
    metaEl.innerHTML = metaHtml;
  }

  intents = updatedIntents;
}

// ── Intent CRUD ─────────────────────────────────────────
async function loadIntents(): Promise<void> {
  intents = await intentAPI.list();
  activeSessionIntents = new Set(await intentAPI.getActiveSessions());
  updateFocusBanner();
  render();
}

function render(): void {
  let displayList: Intent[];

  if (searchResults !== null) {
    // Search mode — show search results directly
    displayList = searchResults;
  } else {
    // Normal mode — apply filter
    let filtered: Intent[];
    switch (currentFilter) {
      case 'scheduled':
        filtered = intents.filter(i => i.status !== 'done' && (i.due_at_utc || i.due_at));
        break;
      case 'unscheduled':
        filtered = intents.filter(i => i.status !== 'done' && !i.due_at_utc && !i.due_at);
        break;
      case 'past':
        filtered = intents.filter(i => i.status === 'done');
        break;
      default: // 'all'
        filtered = intents;
    }

    const active = filtered.filter(i => i.status !== 'done');
    const done = filtered.filter(i => i.status === 'done');
    displayList = currentFilter === 'past' ? done : [...active, ...done];
  }
  displayedIntents = displayList;

  countEl.textContent = String(intents.filter(i => i.status !== 'done').length);

  if (displayList.length === 0) {
    const emptyMsg = searchResults !== null ? 'No matching intents.' :
                     currentFilter === 'all' ? 'No intents yet. Type or speak one above.' :
                     currentFilter === 'scheduled' ? 'No scheduled intents.' :
                     currentFilter === 'unscheduled' ? 'No open intents without a date.' :
                     'No past intents.';
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="icon">🎯</span>
        <span>${emptyMsg}</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = displayList.map(intent => {
    const isProcessing = processingIntents.has(intent.id);
    const isRecurring = !!intent.recurrence;
    const isRunning = activeSessionIntents.has(intent.id);
    const dueInfo = formatDueDate(intent.due_at_utc, intent.due_at);
    const hasDue = dueInfo.text !== '';

    const isFocused = intent.id === focusedIntentId;

    return `
    <div class="intent-item ${intent.status === 'done' ? 'done' : ''} ${isProcessing ? 'processing' : ''} ${isFocused ? 'focused' : ''}" data-id="${intent.id}" onclick="openCanvas('${intent.id}')">
      <div class="intent-check ${intent.status === 'done' ? 'checked' : ''}"
           onclick="event.stopPropagation(); toggleStatus('${intent.id}')">${intent.status === 'done' ? '✓' : ''}</div>
      <div class="intent-content">
        <div class="intent-desc">${escapeHtml(intent.description)}</div>
        <div class="intent-meta">
          ${intent.client ? `<span>👤 ${escapeHtml(intent.client)}</span>` : ''}
          ${hasDue ? `<span class="due-badge ${dueInfo.overdue ? 'overdue' : ''}">📅 ${escapeHtml(dueInfo.text)}</span>` : ''}
          ${isRecurring ? '<span class="recurring-badge">↻</span>' : ''}
          ${isRunning ? '<span class="session-badge running">● running</span>' : intent.session_id ? '<span class="session-badge">○ session</span>' : ''}
          ${isProcessing ? '<span class="processing-badge">refining...</span>' : ''}
          <span>${timeAgo(intent.updated_at)}</span>
        </div>
        <div class="recall-hint hidden" data-recall-for="${intent.id}"></div>
      </div>
      ${intent.status !== 'done' ? `<button class="intent-focus ${isFocused ? 'is-focused' : ''}" onclick="event.stopPropagation(); setFocus('${intent.id}')" title="${isFocused ? 'Unfocus' : 'Focus'}">🎯</button>` : ''}
      <button class="intent-launch ${intent.session_id ? 'has-session' : ''} ${isRunning ? 'is-running' : ''}" onclick="event.stopPropagation(); launchSession('${intent.id}')" title="${isRunning ? 'Switch to session' : intent.session_id ? 'Resume session' : 'Start session'}">▶</button>
      <button class="intent-delete" onclick="event.stopPropagation(); deleteIntent('${intent.id}')">✕</button>
    </div>
  `;
  }).join('');

  if (selectedIndex >= displayedIntents.length) {
    selectedIndex = -1;
  }
  updateSelection();
}

function updateSelection(): void {
  const items = listEl.querySelectorAll('.intent-item');
  items.forEach((item, i) => {
    item.classList.toggle('kb-selected', i === selectedIndex);
  });
  if (selectedIndex >= 0 && items[selectedIndex]) {
    (items[selectedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDueDate(due_at_utc: string | null, due_at: string | null): { text: string; overdue: boolean } {
  if (!due_at_utc) {
    return due_at ? { text: due_at, overdue: false } : { text: '', overdue: false };
  }

  const due = new Date(due_at_utc);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const overdue = diffMs < 0;

  if (overdue) {
    const absDays = Math.abs(diffDays);
    if (absDays === 0) return { text: 'due today', overdue: true };
    if (absDays === 1) return { text: '1d overdue', overdue: true };
    return { text: `${absDays}d overdue`, overdue: true };
  }

  if (diffDays === 0) return { text: 'due today', overdue: false };
  if (diffDays === 1) return { text: 'tomorrow', overdue: false };
  if (diffDays <= 7) return { text: `in ${diffDays}d`, overdue: false };

  // Absolute date for further out
  return {
    text: due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    overdue: false,
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (searchMode) return;
  const text = descInput.value.trim();
  if (!text) return;

  descInput.value = '';
  descInput.style.height = 'auto';
  descInput.focus();
  searchResults = null;

  // Create as intent with body
  queryResult.classList.add('hidden');
  listEl.classList.remove('hidden');
  const intent = await intentAPI.create({ body: text }) as any;
  if (intent.error === 'no_workspace') {
    showStatus('Select a workspace directory first');
    const ws = await intentAPI.selectWorkspace();
    if (ws.selected) {
      updateWorkspaceDisplay(ws.path!);
      const retryIntent = await intentAPI.create({ body: text }) as any;
      if (retryIntent.error) {
        showStatus('Failed to create intent', true);
        return;
      }
      processingIntents.add(retryIntent.id);
    } else {
      hideStatus();
      return;
    }
  } else {
    processingIntents.add(intent.id);
  }
  hideStatus();
  await loadIntents();
});

// Listen for background LLM processing completion
intentAPI.onIntentProcessed(async (id: string) => {
  processingIntents.delete(id);
  await animateRefinement(id);
});

// Listen for recurrence evaluation results
intentAPI.onRecurrenceResult((intentId: string, result: RecurrenceResult) => {
  if (!result.should_recur) return;

  const dueText = result.next_due || result.next_due_utc || 'soon';
  statusBar.innerHTML = `↻ Recurring — next due ${escapeHtml(dueText)} <button class="dismiss-recurrence" onclick="dismissRecurrence('${intentId}')">✕</button>`;
  statusBar.classList.remove('hidden', 'error');
  statusBar.classList.add('recurrence');
});

// Listen for recurrence being applied (after undo window)
intentAPI.onRecurrenceApplied(async (_intentId: string) => {
  hideStatus();
  await loadIntents();
});

// Listen for recall hints
intentAPI.onRecallHint((intentId: string, match: RecallMatch) => {
  const hintEl = listEl.querySelector(`[data-recall-for="${intentId}"]`) as HTMLElement | null;
  if (!hintEl) return;

  const ago = match.completed_at ? timeAgo(match.completed_at) : '';
  hintEl.innerHTML = `💡 Similar: "${escapeHtml(match.description)}"${ago ? ` (done ${ago})` : ''}`;
  hintEl.classList.remove('hidden');

  // Auto-dismiss after 5 seconds unless hovered
  let dismissed = false;
  hintEl.addEventListener('mouseenter', () => { dismissed = true; });
  setTimeout(() => {
    if (!dismissed) {
      hintEl.classList.add('hidden');
    }
  }, 5000);
});

// @ts-ignore - called from onclick in status bar HTML
async function dismissRecurrence(intentId: string): Promise<void> {
  await intentAPI.dismissRecurrence(intentId);
  hideStatus();
}

(window as any).dismissRecurrence = dismissRecurrence;

// ── Session launch ──────────────────────────────────────
// @ts-ignore - called from onclick in HTML
async function launchSession(intentId: string): Promise<void> {
  const result = await intentAPI.launchSession(intentId);
  if (result.success) {
    intentAPI.hideWindow();
    await loadIntents();
  } else if (result.error === 'no_workspace') {
    // Prompt to select workspace
    showStatus('Select a workspace directory first');
    const ws = await intentAPI.selectWorkspace();
    if (ws.selected) {
      updateWorkspaceDisplay(ws.path!);
      // Retry launch
      const retry = await intentAPI.launchSession(intentId);
      if (retry.success) {
        intentAPI.hideWindow();
        await loadIntents();
      } else {
        showStatus(retry.error || 'Launch failed', true);
      }
    } else {
      hideStatus();
    }
  } else {
    showStatus(result.error || 'Launch failed', true);
    setTimeout(hideStatus, 3000);
  }
}

(window as any).launchSession = launchSession;

// ── Workspace setting ───────────────────────────────────
const workspacePathEl = document.getElementById('workspace-path') as HTMLSpanElement;
const workspaceBtn = document.getElementById('workspace-btn') as HTMLButtonElement;

function updateWorkspaceDisplay(path: string | null): void {
  if (path) {
    // Show last 2 path segments for brevity
    const parts = path.replace(/\\/g, '/').split('/');
    const short = parts.length > 2 ? '…/' + parts.slice(-2).join('/') : path;
    workspacePathEl.textContent = short;
    workspacePathEl.title = path;
  } else {
    workspacePathEl.textContent = 'Not set';
    workspacePathEl.title = '';
  }
}

workspaceBtn.addEventListener('click', async () => {
  const result = await intentAPI.selectWorkspace();
  if (result.selected) {
    updateWorkspaceDisplay(result.path);
  }
});

// ── Inline editing ──────────────────────────────────────
// @ts-ignore - called from onclick in HTML
async function editDescription(intentId: string): Promise<void> {
  const intent = intents.find(i => i.id === intentId);
  if (!intent) return;

  const descEl = listEl.querySelector(`[data-id="${intentId}"] .intent-desc`) as HTMLElement;
  if (!descEl || descEl.querySelector('input')) return; // Already editing

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input';
  input.value = intent.description;

  descEl.textContent = '';
  descEl.appendChild(input);
  input.focus();
  input.select();

  const save = async () => {
    const newDesc = input.value.trim();
    if (newDesc && newDesc !== intent.description) {
      await intentAPI.update(intentId, { description: newDesc });
    }
    await loadIntents();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { loadIntents(); }
  });
  input.addEventListener('blur', save);
}

// @ts-ignore - called from onclick in HTML
async function editDate(intentId: string): Promise<void> {
  const intent = intents.find(i => i.id === intentId);
  if (!intent) return;

  const itemEl = listEl.querySelector(`[data-id="${intentId}"]`);
  const badge = itemEl?.querySelector('.due-badge') as HTMLElement;
  if (!badge || badge.querySelector('input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input inline-edit-date';
  input.placeholder = 'e.g. next Friday, May 1...';
  input.value = intent.due_at || '';

  badge.textContent = '';
  badge.appendChild(input);
  input.focus();
  input.select();

  const save = async () => {
    const dateText = input.value.trim();
    if (dateText) {
      badge.textContent = '📅 resolving...';
      const resolved = await intentAPI.resolveDate(dateText);
      await intentAPI.update(intentId, { due_at: resolved.due_at, due_at_utc: resolved.due_at_utc });
    } else {
      // Clear the date
      await intentAPI.update(intentId, { due_at: null, due_at_utc: null });
    }
    await loadIntents();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { loadIntents(); }
  });
  input.addEventListener('blur', save);
}

(window as any).editDescription = editDescription;
(window as any).editDate = editDate;

// ── Body toggle & edit ──────────────────────────────────
function toggleBody(el: HTMLElement): void {
  const isCollapsed = el.classList.contains('collapsed');
  const preview = el.querySelector('.body-preview') as HTMLElement;
  const full = el.querySelector('.body-full') as HTMLElement;
  if (!preview || !full) return;

  if (isCollapsed) {
    el.classList.remove('collapsed');
    el.classList.add('expanded');
    preview.classList.add('hidden');
    full.classList.remove('hidden');
  } else {
    el.classList.add('collapsed');
    el.classList.remove('expanded');
    preview.classList.remove('hidden');
    full.classList.add('hidden');
  }
}

(window as any).toggleBody = toggleBody;

async function editBody(intentId: string): Promise<void> {
  const intent = intents.find(i => i.id === intentId);
  if (!intent || !intent.body) return;

  const itemEl = listEl.querySelector(`[data-id="${intentId}"]`);
  let bodyEl = itemEl?.querySelector('.intent-body') as HTMLElement | null;

  // If no body element exists, create one
  const contentEl = itemEl?.querySelector('.intent-content') as HTMLElement;
  if (!contentEl) return;

  if (!bodyEl) {
    bodyEl = document.createElement('div');
    bodyEl.className = 'intent-body expanded';
    const descEl = contentEl.querySelector('.intent-desc');
    if (descEl) descEl.after(bodyEl);
    else contentEl.prepend(bodyEl);
  }

  if (bodyEl.querySelector('textarea')) return; // Already editing

  const textarea = document.createElement('textarea');
  textarea.className = 'inline-edit-body';
  textarea.value = intent.body;
  textarea.rows = Math.min(intent.body.split('\n').length + 1, 8);

  bodyEl.innerHTML = '';
  bodyEl.classList.remove('collapsed');
  bodyEl.classList.add('expanded');
  bodyEl.appendChild(textarea);
  textarea.focus();

  const save = async () => {
    const newBody = textarea.value.trim();
    if (newBody && newBody !== intent.body) {
      await intentAPI.update(intentId, { body: newBody });
    }
    await loadIntents();
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { loadIntents(); }
  });
  textarea.addEventListener('blur', save);
}

(window as any).editBody = editBody;

// ── Attachments ─────────────────────────────────────────
async function addAttachment(intentId: string): Promise<void> {
  const intent = intents.find(i => i.id === intentId);
  if (!intent) return;

  const itemEl = listEl.querySelector(`[data-id="${intentId}"]`);
  const contentEl = itemEl?.querySelector('.intent-content') as HTMLElement;
  if (!contentEl) return;

  // Check if already has an input open
  if (contentEl.querySelector('.attachment-input-row')) return;

  const row = document.createElement('div');
  row.className = 'attachment-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input attachment-url-input';
  input.placeholder = 'Paste a URL...';
  row.appendChild(input);

  const metaEl = contentEl.querySelector('.intent-meta');
  if (metaEl) metaEl.before(row);
  else contentEl.appendChild(row);
  input.focus();

  const save = async () => {
    const url = input.value.trim();
    if (url && /^https?:\/\//i.test(url)) {
      // Auto-name from URL hostname + path
      let name = '';
      try {
        const u = new URL(url);
        const pathParts = u.pathname.split('/').filter(Boolean);
        name = pathParts.length > 0 ? pathParts[pathParts.length - 1] : u.hostname;
      } catch {
        name = url.slice(0, 40);
      }
      const attachments = [...(intent.attachments || []), { type: 'url' as const, name, url }];
      await intentAPI.update(intentId, { attachments });
    } else if (url) {
      // Not a valid URL — just remove the input
    }
    row.remove();
    await loadIntents();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { row.remove(); }
  });
  input.addEventListener('blur', save);
}

async function removeAttachment(intentId: string, index: number): Promise<void> {
  const intent = intents.find(i => i.id === intentId);
  if (!intent) return;
  const attachments = [...(intent.attachments || [])];
  attachments.splice(index, 1);
  await intentAPI.update(intentId, { attachments });
  await loadIntents();
}

(window as any).addAttachment = addAttachment;
(window as any).removeAttachment = removeAttachment;

// @ts-ignore - called from onclick in query result
function dismissQuery(): void {
  queryResult.classList.add('hidden');
  listEl.classList.remove('hidden');
}
(window as any).dismissQuery = dismissQuery;

// ── Focus mode ──────────────────────────────────────────
async function setFocus(intentId: string): Promise<void> {
  if (focusedIntentId === intentId) {
    // Toggle off
    clearFocus();
    return;
  }
  focusedIntentId = intentId;
  await intentAPI.setSetting('focused_intent', intentId);
  updateFocusBanner();
  render();
}

function clearFocus(): void {
  focusedIntentId = null;
  intentAPI.setSetting('focused_intent', '');
  focusBanner.classList.add('hidden');
  render();
}

function updateFocusBanner(): void {
  if (!focusedIntentId) {
    focusBanner.classList.add('hidden');
    return;
  }
  const intent = intents.find(i => i.id === focusedIntentId);
  if (!intent || intent.status === 'done') {
    clearFocus();
    return;
  }

  const dueInfo = formatDueDate(intent.due_at_utc, intent.due_at);
  focusDesc.textContent = intent.description;
  let meta = '';
  if (intent.client) meta += `👤 ${intent.client}  `;
  if (dueInfo.text) meta += `📅 ${dueInfo.text}`;
  focusMeta.textContent = meta;
  focusBanner.classList.remove('hidden');
}

focusDone.addEventListener('click', async () => {
  if (!focusedIntentId) return;
  await intentAPI.update(focusedIntentId, { status: 'done' });
  clearFocus();
  await loadIntents();
});

focusClear.addEventListener('click', clearFocus);

async function loadFocusState(): Promise<void> {
  const saved = await intentAPI.getSetting('focused_intent');
  if (saved) {
    focusedIntentId = saved;
    updateFocusBanner();
  }
}

(window as any).setFocus = setFocus;

// ── Timeline view ───────────────────────────────────────
function showTimeline(): void {
  mainView.classList.add('hidden');
  settingsView.classList.add('hidden');
  timelineView.classList.remove('hidden');
  loadTimeline();
}

function hideTimeline(): void {
  timelineView.classList.add('hidden');
  mainView.classList.remove('hidden');
  descInput.focus();
}

timelineBtn.addEventListener('click', showTimeline);
timelineBack.addEventListener('click', hideTimeline);

async function loadTimeline(): Promise<void> {
  const events = await intentAPI.listEvents(200);

  if (events.length === 0) {
    timelineContent.innerHTML = `
      <div class="empty-state">
        <span class="icon">📋</span>
        <span>No activity yet.</span>
      </div>`;
    return;
  }

  // Group events by date
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const date = new Date(event.created_at).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    });
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(event);
  }

  let html = '';
  for (const [date, dateEvents] of groups) {
    html += `<div class="timeline-date-group">
      <div class="timeline-date">${date}</div>`;

    for (const event of dateEvents) {
      const time = new Date(event.created_at).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit'
      });
      const icon = event.event_type === 'completed' ? '✅' :
                   event.event_type === 'recycled' ? '↻' :
                   event.event_type === 'recurrence_dismissed' ? '✕' : '•';
      const label = event.event_type === 'completed' ? 'Completed' :
                    event.event_type === 'recycled' ? 'Rescheduled' :
                    event.event_type === 'recurrence_dismissed' ? 'Recurrence dismissed' :
                    event.event_type;
      const desc = event.intent_description ? escapeHtml(event.intent_description) : 'Unknown intent';
      const sessionTag = event.session_id ? '<span class="timeline-session-tag">has session</span>' : '';

      html += `
        <div class="timeline-event">
          <span class="timeline-icon">${icon}</span>
          <div class="timeline-event-content">
            <div class="timeline-event-desc">${desc}</div>
            <div class="timeline-event-meta">
              <span>${label}</span>
              ${event.due_at ? `<span>📅 ${escapeHtml(event.due_at)}</span>` : ''}
              ${sessionTag}
              <span>${time}</span>
            </div>
          </div>
        </div>`;
    }
    html += `</div>`;
  }

  timelineContent.innerHTML = html;
}


// @ts-ignore - called from onclick in HTML
async function toggleStatus(id: string): Promise<void> {
  const intent = intents.find(i => i.id === id);
  if (!intent) return;
  const newStatus = intent.status === 'done' ? 'captured' : 'done';
  await intentAPI.update(id, { status: newStatus });
  await loadIntents();
}

// @ts-ignore - called from onclick in HTML
async function deleteIntent(id: string): Promise<void> {
  await intentAPI.delete(id);
  await loadIntents();
}

(window as any).toggleStatus = toggleStatus;
(window as any).deleteIntent = deleteIntent;

// ── Canvas view ─────────────────────────────────────────
import { mountCanvas, unmountCanvas, getCanvasContent, saveCanvas as saveCanvasEditor } from './canvas/mount.tsx';

const canvasView = document.getElementById('canvas-view') as HTMLDivElement;
const canvasBack = document.getElementById('canvas-back') as HTMLButtonElement;
const canvasTitle = document.getElementById('canvas-title') as HTMLHeadingElement;
const canvasSaveStatus = document.getElementById('canvas-save-status') as HTMLSpanElement;
const canvasLaunchBtn = document.getElementById('canvas-launch') as HTMLButtonElement;
const canvasSaveBtn = document.getElementById('canvas-save') as HTMLButtonElement;
const canvasRoot = document.getElementById('canvas-root') as HTMLDivElement;
let canvasIntentId: string | null = null;
let canvasDirty = false;

async function openCanvas(intentId: string): Promise<void> {
  const intent = intents.find(i => i.id === intentId);
  if (!intent) return;

  canvasIntentId = intentId;
  canvasTitle.textContent = intent.description;
  canvasSaveStatus.textContent = '';
  canvasDirty = false;
  canvasSaveBtn.classList.add('hidden');

  // Load canvas content
  const result = await intentAPI.readCanvas(intentId);
  if (result.error === 'no_workspace') {
    showStatus('Select a workspace first');
    return;
  }

  // Determine current theme
  const currentTheme = (await intentAPI.getSetting('theme') || 'light') as 'light' | 'dark';

  // Show canvas view
  mainView.classList.add('hidden');
  settingsView.classList.add('hidden');
  timelineView.classList.add('hidden');
  canvasView.classList.remove('hidden');

  // Mount Documint editor
  mountCanvas(canvasRoot, {
    intentId,
    content: result.content || '',
    theme: currentTheme,
    onDirtyChange: (dirty: boolean) => {
      canvasDirty = dirty;
      canvasSaveBtn.classList.toggle('hidden', !dirty);
    },
    onSaveStatus: (status: string) => {
      canvasSaveStatus.textContent = status;
    },
  });
}

async function saveCanvas(): Promise<void> {
  await saveCanvasEditor();
}

async function closeCanvas(): Promise<void> {
  const intentId = canvasIntentId;
  canvasIntentId = null;

  // Get content BEFORE unmounting (unmount destroys the React ref)
  const finalContent = getCanvasContent();
  await unmountCanvas();

  if (intentId) {
    await intentAPI.closeCanvas(intentId, finalContent);
  }

  canvasDirty = false;
  canvasView.classList.add('hidden');
  mainView.classList.remove('hidden');
  descInput.focus();
  loadIntents();
}

canvasSaveBtn.addEventListener('click', saveCanvas);
canvasBack.addEventListener('click', closeCanvas);

canvasLaunchBtn.addEventListener('click', () => {
  if (canvasIntentId) launchSession(canvasIntentId);
});

(window as any).openCanvas = openCanvas;

// ── Init ────────────────────────────────────────────────
descInput.focus();
loadSettings();
loadFocusState();

// Flush canvas saves when the window is about to close (app quit, reload)
window.addEventListener('beforeunload', () => {
  if (canvasIntentId) {
    const content = getCanvasContent();
    intentAPI.closeCanvas(canvasIntentId, content);
  }
});

document.addEventListener('keydown', (e) => {
  // Arrow/Enter navigation in the intent list
  if (!mainView.classList.contains('hidden')) {
    if (e.key === 'ArrowDown' && selectedIndex >= 0) {
      e.preventDefault();
      if (selectedIndex < displayedIntents.length - 1) {
        selectedIndex++;
        updateSelection();
      }
      return;
    }
    if (e.key === 'ArrowUp' && selectedIndex >= 0) {
      e.preventDefault();
      if (selectedIndex === 0) {
        selectedIndex = -1;
        updateSelection();
        descInput.focus();
      } else {
        selectedIndex--;
        updateSelection();
      }
      return;
    }
    if (e.key === 'Enter' && selectedIndex >= 0 && document.activeElement !== descInput) {
      e.preventDefault();
      const intent = displayedIntents[selectedIndex];
      if (intent) openCanvas(intent.id);
      return;
    }
    // Cmd+Enter: open canvas for selected intent (or first if none selected)
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      const target = selectedIndex >= 0
        ? displayedIntents[selectedIndex]
        : displayedIntents[0];
      if (target) openCanvas(target.id);
      return;
    }
  }

  if (e.key === 'Escape') {
    if (isRecording) stopRecording();
    if (!canvasView.classList.contains('hidden')) {
      closeCanvas();
      return;
    }
    if (!settingsView.classList.contains('hidden')) {
      hideSettings();
      return;
    }
    if (!timelineView.classList.contains('hidden')) {
      hideTimeline();
      return;
    }
    intentAPI.hideWindow();
  }
});

intentAPI.onWindowShown(() => {
  selectedIndex = -1;
  searchResults = null;
  if (searchMode) exitSearchMode();
  descInput.focus();
  descInput.select();
  hideStatus();
  // Refresh active session state when window reappears
  loadIntents();
});

loadIntents();
