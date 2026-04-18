interface IntentAPI {
  create(input: { description: string; client?: string; due_at?: string }): Promise<Intent>;
  list(): Promise<Intent[]>;
  update(id: string, updates: Record<string, unknown>): Promise<Intent>;
  delete(id: string): Promise<boolean>;
  parse(rawText: string): Promise<{ description: string; client: string | null; due_at: string | null }>;
  transcribe(audioData: number[]): Promise<string>;
  hideWindow(): void;
  onWindowShown(callback: () => void): void;
}

interface Intent {
  id: string;
  description: string;
  client: string | null;
  due_at: string | null;
  status: 'captured' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

declare const intentAPI: IntentAPI;

const descInput = document.getElementById('description-input') as HTMLInputElement;
const clientInput = document.getElementById('client-input') as HTMLInputElement;
const dueInput = document.getElementById('due-input') as HTMLInputElement;
const form = document.getElementById('capture-form') as HTMLFormElement;
const listEl = document.getElementById('intent-list') as HTMLDivElement;
const countEl = document.getElementById('intent-count') as HTMLSpanElement;
const voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
const aiCaptureBtn = document.getElementById('ai-capture-btn') as HTMLButtonElement;
const statusBar = document.getElementById('status-bar') as HTMLDivElement;

let intents: Intent[] = [];

// ── Status bar helpers ──────────────────────────────────
function showStatus(msg: string, isError = false): void {
  statusBar.textContent = msg;
  statusBar.classList.remove('hidden', 'error');
  if (isError) statusBar.classList.add('error');
}

function hideStatus(): void {
  statusBar.classList.add('hidden');
}

// ── Voice Input (MediaRecorder → local Whisper) ─────────
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
      // Clean up the stream
      audioStream?.getTracks().forEach(t => t.stop());
      audioStream = null;

      if (audioChunks.length === 0) {
        showStatus('No audio captured', true);
        return;
      }

      showStatus('🤖 Transcribing with Whisper...');
      voiceBtn.classList.remove('recording');
      voiceBtn.classList.add('transcribing');
      voiceBtn.textContent = '⏳';

      try {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const float32 = await blobToFloat32(blob);
        const text = await intentAPI.transcribe(Array.from(float32));

        if (text) {
          descInput.value = text;
          showStatus('✅ Voice captured — press AI Capture or Capture');
        } else {
          showStatus('No speech detected. Try again.', true);
        }
      } catch (err) {
        console.error('Transcription failed:', err);
        showStatus('Transcription failed', true);
      } finally {
        voiceBtn.classList.remove('transcribing');
        voiceBtn.textContent = '🎤';
      }
    };

    isRecording = true;
    voiceBtn.classList.add('recording');
    voiceBtn.textContent = '⏹';
    descInput.value = '';
    descInput.placeholder = 'Listening...';
    showStatus('🎤 Recording... click mic to stop');
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
  descInput.placeholder = 'What do you need to do?';
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

// Convert audio Blob to Float32Array (mono 16kHz for Whisper)
async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0); // mono
  audioCtx.close();
  return channelData;
}

voiceBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// ── AI Capture ──────────────────────────────────────────
aiCaptureBtn.addEventListener('click', async () => {
  const rawText = descInput.value.trim();
  if (!rawText) {
    descInput.focus();
    return;
  }

  aiCaptureBtn.classList.add('loading');
  aiCaptureBtn.textContent = '⏳ Parsing...';
  showStatus('🤖 Copilot is parsing your intent...');

  try {
    const parsed = await intentAPI.parse(rawText);

    // Fill in the parsed fields
    descInput.value = parsed.description;
    if (parsed.client) clientInput.value = parsed.client;
    if (parsed.due_at) dueInput.value = parsed.due_at;

    showStatus('✅ AI parsed — review fields and hit Capture');
  } catch (err) {
    console.error('AI parse failed:', err);
    showStatus('AI parse failed — capturing as-is', true);
  } finally {
    aiCaptureBtn.classList.remove('loading');
    aiCaptureBtn.textContent = '⚡ AI Capture';
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
        <span>No intents yet. Capture one above.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = [...active, ...done].map(intent => `
    <div class="intent-item ${intent.status === 'done' ? 'done' : ''}" data-id="${intent.id}">
      <div class="intent-check ${intent.status === 'done' ? 'checked' : ''}"
           onclick="toggleStatus('${intent.id}')">${intent.status === 'done' ? '✓' : ''}</div>
      <div class="intent-content">
        <div class="intent-desc">${escapeHtml(intent.description)}</div>
        <div class="intent-meta">
          ${intent.client ? `<span>👤 ${escapeHtml(intent.client)}</span>` : ''}
          ${intent.due_at ? `<span>📅 ${escapeHtml(intent.due_at)}</span>` : ''}
          <span>${timeAgo(intent.created_at)}</span>
        </div>
      </div>
      <button class="intent-delete" onclick="deleteIntent('${intent.id}')">✕</button>
    </div>
  `).join('');
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

  const client = clientInput.value.trim() || undefined;
  const due_at = dueInput.value.trim() || undefined;

  await intentAPI.create({ description, client, due_at });
  descInput.value = '';
  clientInput.value = '';
  dueInput.value = '';
  hideStatus();
  descInput.focus();
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isRecording) stopRecording();
    intentAPI.hideWindow();
  }
});

intentAPI.onWindowShown(() => {
  descInput.focus();
  descInput.select();
  hideStatus();
});

loadIntents();
