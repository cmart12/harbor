interface IntentAPI {
  create(input: { description: string; client?: string; due_at?: string }): Promise<Intent>;
  list(): Promise<Intent[]>;
  update(id: string, updates: Record<string, unknown>): Promise<Intent>;
  delete(id: string): Promise<boolean>;
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

let intents: Intent[] = [];

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

// Make functions available globally for onclick handlers
(window as any).toggleStatus = toggleStatus;
(window as any).deleteIntent = deleteIntent;

// Auto-focus on load
descInput.focus();

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    intentAPI.hideWindow();
  }
});

// Listen for show event from main process
intentAPI.onWindowShown(() => {
  descInput.focus();
  descInput.select();
});

// Initial load
loadIntents();
