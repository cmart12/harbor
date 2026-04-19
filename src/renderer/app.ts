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
  create(input: { description: string }): Promise<Intent>;
  list(): Promise<Intent[]>;
  update(id: string, updates: Record<string, unknown>): Promise<Intent>;
  delete(id: string): Promise<boolean>;
  dismissRecurrence(id: string): Promise<boolean>;
  transcribe(audioData: number[]): Promise<string>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listModels(): Promise<{ id: string; name?: string }[]>;
  launchSession(intentId: string): Promise<{ success: boolean; error?: string; sessionId?: string }>;
  selectWorkspace(): Promise<{ selected: boolean; path: string | null }>;
  hideWindow(): void;
  onWindowShown(callback: () => void): void;
  onIntentProcessed(callback: (id: string) => void): void;
  onRecurrenceResult(callback: (intentId: string, result: RecurrenceResult) => void): void;
  onRecurrenceApplied(callback: (intentId: string) => void): void;
  onRecallHint(callback: (intentId: string, match: RecallMatch) => void): void;
}

interface Intent {
  id: string;
  description: string;
  raw_text: string | null;
  client: string | null;
  due_at: string | null;
  due_at_utc: string | null;
  recurrence: string | null;
  completed_at: string | null;
  session_id: string | null;
  status: 'captured' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

declare const intentAPI: IntentAPI;

const descInput = document.getElementById('description-input') as HTMLInputElement;
const form = document.getElementById('capture-form') as HTMLFormElement;
const listEl = document.getElementById('intent-list') as HTMLDivElement;
const countEl = document.getElementById('intent-count') as HTMLSpanElement;
const statusBar = document.getElementById('status-bar') as HTMLDivElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLDivElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const recordingIndicator = document.getElementById('recording-indicator') as HTMLDivElement;

let intents: Intent[] = [];
// Track intents being processed by LLM
const processingIntents = new Set<string>();

// ── Status bar helpers ──────────────────────────────────
function showStatus(msg: string, isError = false): void {
  statusBar.textContent = msg;
  statusBar.classList.remove('hidden', 'error');
  if (isError) statusBar.classList.add('error');
}

function hideStatus(): void {
  statusBar.classList.add('hidden');
}

// ── Settings ────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
  settingsBtn.classList.toggle('active');
  if (!settingsPanel.classList.contains('hidden')) {
    loadModels();
  }
});

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
  // Settings are loaded on-demand when panel opens
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
      descInput.placeholder = 'Type or press space to speak...';
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

// Spacebar handling on the input
descInput.addEventListener('keydown', (e) => {
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
  render();
}

function render(): void {
  const active = intents.filter(i => i.status !== 'done');
  const done = intents.filter(i => i.status === 'done');

  countEl.textContent = String(active.length);

  if (intents.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="icon">🎯</span>
        <span>No intents yet. Type or speak one above.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = [...active, ...done].map(intent => {
    const isProcessing = processingIntents.has(intent.id);
    const isRecurring = !!intent.recurrence;
    const dueInfo = formatDueDate(intent.due_at_utc, intent.due_at);
    const hasDue = dueInfo.text !== '';

    return `
    <div class="intent-item ${intent.status === 'done' ? 'done' : ''} ${isProcessing ? 'processing' : ''}" data-id="${intent.id}">
      <div class="intent-check ${intent.status === 'done' ? 'checked' : ''}"
           onclick="toggleStatus('${intent.id}')">${intent.status === 'done' ? '✓' : ''}</div>
      <div class="intent-content">
        <div class="intent-desc">${escapeHtml(intent.description)}</div>
        <div class="intent-meta">
          ${intent.client ? `<span>👤 ${escapeHtml(intent.client)}</span>` : ''}
          ${hasDue ? `<span class="due-badge ${dueInfo.overdue ? 'overdue' : ''}">📅 ${escapeHtml(dueInfo.text)}</span>` : ''}
          ${isRecurring ? '<span class="recurring-badge">↻</span>' : ''}
          ${intent.session_id ? '<span class="session-badge">⬤ session</span>' : ''}
          ${isProcessing ? '<span class="processing-badge">refining...</span>' : ''}
          <span>${timeAgo(intent.updated_at)}</span>
        </div>
        <div class="recall-hint hidden" data-recall-for="${intent.id}"></div>
      </div>
      <button class="intent-launch ${intent.session_id ? 'has-session' : ''}" onclick="launchSession('${intent.id}')" title="${intent.session_id ? 'Resume session' : 'Start session'}">▶</button>
      <button class="intent-delete" onclick="deleteIntent('${intent.id}')">✕</button>
    </div>
  `;
  }).join('');
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
  const description = descInput.value.trim();
  if (!description) return;

  const intent = await intentAPI.create({ description });
  processingIntents.add(intent.id);
  descInput.value = '';
  hideStatus();
  descInput.focus();
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
    showStatus('✓ Workspace set');
    setTimeout(hideStatus, 2000);
  }
});

// Load workspace on settings panel open
const origSettingsClick = settingsBtn.onclick;
settingsBtn.addEventListener('click', async () => {
  if (!settingsPanel.classList.contains('hidden')) {
    const ws = await intentAPI.getSetting('workspace_root');
    updateWorkspaceDisplay(ws);
  }
});

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

// ── Init ────────────────────────────────────────────────
descInput.focus();
loadSettings();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isRecording) stopRecording();
    if (!settingsPanel.classList.contains('hidden')) {
      settingsPanel.classList.add('hidden');
      settingsBtn.classList.remove('active');
      descInput.focus();
      return;
    }
    intentAPI.hideWindow();
  }
});

intentAPI.onWindowShown(() => {
  descInput.focus();
  descInput.select();
  hideStatus();
});

loadIntents();
