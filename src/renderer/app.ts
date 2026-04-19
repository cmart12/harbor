interface IntentAPI {
  create(input: { description: string }): Promise<Intent>;
  list(): Promise<Intent[]>;
  update(id: string, updates: Record<string, unknown>): Promise<Intent>;
  delete(id: string): Promise<boolean>;
  transcribe(audioData: number[]): Promise<string>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listModels(): Promise<{ id: string; name?: string }[]>;
  hideWindow(): void;
  onWindowShown(callback: () => void): void;
  onIntentProcessed(callback: (id: string) => void): void;
}

interface Intent {
  id: string;
  description: string;
  raw_text: string | null;
  client: string | null;
  due_at: string | null;
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
    return `
    <div class="intent-item ${intent.status === 'done' ? 'done' : ''} ${isProcessing ? 'processing' : ''}" data-id="${intent.id}">
      <div class="intent-check ${intent.status === 'done' ? 'checked' : ''}"
           onclick="toggleStatus('${intent.id}')">${intent.status === 'done' ? '✓' : ''}</div>
      <div class="intent-content">
        <div class="intent-desc">${escapeHtml(intent.description)}</div>
        <div class="intent-meta">
          ${intent.client ? `<span>👤 ${escapeHtml(intent.client)}</span>` : ''}
          ${intent.due_at ? `<span>📅 ${escapeHtml(intent.due_at)}</span>` : ''}
          ${isProcessing ? '<span class="processing-badge">refining...</span>' : ''}
          <span>${timeAgo(intent.created_at)}</span>
        </div>
      </div>
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
  await loadIntents();
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
