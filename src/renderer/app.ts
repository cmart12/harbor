/**
 * MIGRATION NOTE: This file is being incrementally migrated to React components.
 * See src/renderer/MIGRATION.md for the migration plan.
 * New features should use:
 *   - src/renderer/ipc-client.ts (typed IPC)
 *   - src/renderer/state/ (intent-store, agent-store)
 *   - src/renderer/views/ (React components)
 */

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

interface AgentPersona {
  id: string;
  handle: string;
  instructions: string;
  model: string;
  runLocation: 'local' | 'cloud';
  sandboxed?: boolean;
}

interface CliToolDefinition {
  name: string;
  description: string;
}

interface CustomMcpServer {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  tools: string[];
}

interface DiscoveredMcpServer {
  name: string;
  source: 'config' | 'plugin';
  type: string;
  command?: string;
  url?: string;
}

interface FolderCommit {
  sha: string;
  shortSha: string;
  message: string;
  date: string;
  relativeDate: string;
  filesChanged: string[];
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
  resolveCliPath(): Promise<string | null>;
  checkCliVersion(): Promise<{ path: string | null; version: string | null; compatible: boolean; minVersion: string }>;
  listModels(): Promise<{ id: string; name?: string }[]>;
  listPersonas(): Promise<AgentPersona[]>;
  savePersonas(personas: AgentPersona[]): Promise<{ ok?: boolean; error?: string }>;
  listDiscoveredMcp(): Promise<DiscoveredMcpServer[]>;
  listCustomMcp(): Promise<CustomMcpServer[]>;
  saveCustomMcp(servers: CustomMcpServer[]): Promise<{ ok?: boolean; error?: string }>;
  listCliTools(): Promise<CliToolDefinition[]>;
  saveCliTools(tools: CliToolDefinition[]): Promise<{ ok?: boolean; error?: string }>;
  listEvents(limit?: number): Promise<any[]>;
  resolveDate(dateText: string): Promise<{ due_at: string; due_at_utc: string | null }>;
  classifyInput(text: string): Promise<{ type: 'intent' | 'query'; query_answer?: string }>;
  launchSession(intentId: string): Promise<{ success: boolean; error?: string; sessionId?: string }>;
  getActiveSessions(): Promise<string[]>;
  selectWorkspace(): Promise<{ selected: boolean; path: string | null }>;
  clearWorkspace(): Promise<{ ok: boolean }>;
  onWorkspaceChanged(callback: (path: string | null) => void): void;
  readCanvas(intentId: string): Promise<{ content: string; error?: string }>;
  writeCanvas(intentId: string, content: string): Promise<{ success?: boolean; error?: string }>;
  closeCanvas(intentId: string, content: string): Promise<void>;
  canvasHistory(intentId: string): Promise<{ commits: FolderCommit[]; error?: string }>;
  canvasRestore(intentId: string, sha: string): Promise<{ success: boolean; error?: string }>;
  canvasPreviewVersion(intentId: string, sha: string): Promise<{ content: string; error?: string }>;
  searchIntents(query: string): Promise<Intent[]>;
  unarchive(id: string): Promise<Intent | null>;
  summarizeTitle(canvasContent: string): Promise<{ title: string | null }>;
  pasteFile(intentId: string, filename: string, dataArray: number[]): Promise<{ success?: boolean; relativePath?: string; filename?: string; error?: string }>;
  listAgents(intentId: string): Promise<any[]>;
  quickLaunchAgent(prompt: string): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  listAllAgents(): Promise<any[]>;
  deleteAgentSession(agentId: string): Promise<{ ok?: boolean; error?: string }>;
  launchCloudAgent(intentId: string, prompt: string): Promise<{ agentId?: string; sessionId?: string; jobId?: string; error?: string }>;
  getCloudJobStatus(agentId: string): Promise<any>;
  launchCliSession(): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  getAgentHistory(agentId: string): Promise<{ events?: any[]; error?: string }>;
  openAgentCli(agentId: string): Promise<{ error?: string }>;
  onChatEvent(agentId: string, callback: (event: any) => void): () => void;
  launchAgent(intentId: string, selectedText: string, anchor: any, options?: { repo?: string; model?: string }): Promise<any>;
  launchCommentAgent(intentId: string, commentBody: string, quotedText: string, anchor: any, personaHandle: string, threadIndex: number): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<void>;
  abortAgent(agentId: string): Promise<void>;
  hideWindow(): void;
  expandWindow(): void;
  collapseWindow(): void;
  getPinned(): Promise<boolean>;
  setPinned(pinned: boolean): void;
  onPinnedChanged(callback: (pinned: boolean) => void): void;
  openCanvasWindow(target: { kind: string; id: string; title: string }): void;
  onLoadCanvasTarget(callback: (target: { kind: string; id: string; title: string }) => void): void;
  onCanvasWindowClosed(callback: () => void): void;
  notifyCanvasThemeChanged(theme: string): void;
  onCanvasThemeChanged(callback: (theme: string) => void): void;
  openSettingsWindow(): void;
  onWindowShown(callback: (data: { side: 'left' | 'right'; expanded: boolean }) => void): void;
  onWindowToggle(callback: () => void): void;
  onRequestHide(callback: () => void): void;
  onWorkspaceCommitted(callback: () => void): void;
  onIntentProcessed(callback: (id: string) => void): void;
  onRecurrenceResult(callback: (intentId: string, result: RecurrenceResult) => void): void;
  onRecurrenceApplied(callback: (intentId: string) => void): void;
  onRecallHint(callback: (intentId: string, match: RecallMatch) => void): void;
  onAgentStatusChanged(callback: (data: any) => void): void;
  onAgentApprovalNeeded(callback: (data: any) => void): void;
  onAgentCompleted(callback: (data: any) => void): void;
  onNotificationApprovalClicked(callback: (data: { agentId: string }) => void): void;
  onAgentPresenceStarted(callback: (data: { agentId: string; intentId: string; persona: { name: string; handle: string; color?: string; imageUrl?: string }; anchor: { prefix?: string; suffix?: string } }) => void): void;
  onAgentPresenceEnded(callback: (data: { agentId: string; intentId: string }) => void): void;
  onAgentReplyReady(callback: (data: { agentId: string; intentId: string; threadIndex: number; body: string }) => void): void;
  onCanvasContentUpdated(callback: (data: { intentId: string; content: string }) => void): () => void;
  openPath(folderPath: string): Promise<void>;
  // ── Skills ──────────────────────────────────────────────
  listSkills(): Promise<any[]>;
  readSkill(skillId: string): Promise<{ frontmatter: Record<string, unknown>; body: string } | { error: string }>;
  writeSkill(skillId: string, frontmatter: Record<string, unknown>, body: string): Promise<{ success: boolean } | { error: string }>;
  createSkill(name: string): Promise<any>;
  createSkillFromPrompt(description: string): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  deleteSkill(skillId: string): Promise<boolean>;
  openSkillFolder(skillId: string): Promise<void>;
  createIntentFromSkill(skillId: string): Promise<any>;
  launchSkill(skillId: string): Promise<any>;
  onSkillsChanged(callback: () => void): void;
  // ── Platform ─────────────────────────────────────────────
  getPlatform(): string;
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

// ── Canvas window mode detection ────────────────────────
const isCanvasMode = new URLSearchParams(window.location.search).get('mode') === 'canvas';
const isSettingsMode = new URLSearchParams(window.location.search).get('mode') === 'settings';

const descInput = document.getElementById('description-input') as HTMLTextAreaElement;
const form = document.getElementById('capture-form') as HTMLFormElement;
const listEl = document.getElementById('intent-list') as HTMLDivElement;
const countEl = document.getElementById('intent-count') as HTMLSpanElement;
const statusBar = document.getElementById('status-bar') as HTMLDivElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement;
const settingsBackdrop = settingsOverlay.querySelector('.settings-backdrop') as HTMLDivElement;
const settingsClose = document.getElementById('settings-close') as HTMLButtonElement;
const mainView = document.getElementById('main-view') as HTMLDivElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const recordingIndicator = document.getElementById('recording-indicator') as HTMLDivElement;
const waveformCanvas = document.getElementById('waveform-canvas') as HTMLCanvasElement;
const inputHints = document.getElementById('input-hints') as HTMLDivElement;
const themeLightBtn = document.getElementById('theme-light') as HTMLButtonElement;
const themeDarkBtn = document.getElementById('theme-dark') as HTMLButtonElement;
const timelineBtn = document.getElementById('timeline-btn') as HTMLButtonElement | null;
const timelineView = document.getElementById('timeline-view') as HTMLDivElement;
const timelineBack = document.getElementById('timeline-back') as HTMLButtonElement;
const timelineContent = document.getElementById('timeline-content') as HTMLDivElement;
const pinBtn = document.getElementById('pin-btn') as HTMLButtonElement;

// ── Welcome view refs ───────────────────────────────────
const welcomeView = document.getElementById('welcome-view') as HTMLDivElement;
const welcomeWorkspaceBtn = document.getElementById('welcome-workspace-btn') as HTMLButtonElement;
const welcomeWorkspaceHint = document.getElementById('welcome-workspace-hint') as HTMLDivElement;
const welcomeWorkspaceCheck = document.getElementById('welcome-workspace-check') as HTMLSpanElement;
const welcomeStepWorkspace = document.getElementById('welcome-step-workspace') as HTMLDivElement;
const welcomeCliStatus = document.getElementById('welcome-cli-status') as HTMLDivElement;
const welcomeCliCheck = document.getElementById('welcome-cli-check') as HTMLSpanElement;
const welcomeStepCli = document.getElementById('welcome-step-cli') as HTMLDivElement;
const welcomeCliPath = document.getElementById('welcome-cli-path') as HTMLInputElement;
const welcomeCliRefresh = document.getElementById('welcome-cli-refresh') as HTMLButtonElement;
const welcomeModelSelect = document.getElementById('welcome-model-select') as HTMLSelectElement;
const welcomeModelCheck = document.getElementById('welcome-model-check') as HTMLSpanElement;
const welcomeStepModel = document.getElementById('welcome-step-model') as HTMLDivElement;
const welcomeStartBtn = document.getElementById('welcome-start-btn') as HTMLButtonElement;

let intents: Intent[] = [];
// Track intents being processed by LLM
const processingIntents = new Set<string>();
// Track intents with active running terminal sessions
let activeSessionIntents = new Set<string>();
// Track agents per intent for Spaces view
let agentsByIntent = new Map<string, Array<{ agentId: string; status: string; summary: string; selectedText: string; source?: string }>>();
// Current filter
let currentFilter: 'open' | 'agents' | 'skills' | 'closed' = 'open';
const filterOrder: Array<'open' | 'agents' | 'skills' | 'closed'> = ['open', 'agents', 'skills', 'closed'];
let renderGeneration = 0;
const filterBar = document.getElementById('filter-bar') as HTMLDivElement;
const newAgentBtn = document.getElementById('new-agent-btn') as HTMLButtonElement;
const launchCliBtn = document.getElementById('launch-cli-btn') as HTMLButtonElement;
const agentSummaryEl = document.getElementById('agent-summary') as HTMLDivElement;
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
let activeSearchQuery = '';
const workersBadge = document.getElementById('workers-badge') as HTMLSpanElement;

// ── Platform detection ──────────────────────────────────
// Set platform class on body for platform-adaptive styling
const __platform = (window as any).__platform as string | undefined;
if (__platform) {
  document.body.classList.add(`platform-${__platform}`);
}

// ── Window slide animation ──────────────────────────────
const appEl = document.getElementById('app')!;
let windowSide: 'left' | 'right' = 'right';
let windowVisualState: 'hidden' | 'sliding-in' | 'visible' | 'sliding-out' = 'hidden';
let slideTransitionId = 0;

// Start with content off-screen (no transition) so first show() has no flash
if (!isCanvasMode && !isSettingsMode) {
  appEl.classList.add('app-hidden-right', 'app-no-transition');
}

function slideIn(side: 'left' | 'right'): void {
  slideTransitionId++;
  const myId = slideTransitionId;
  windowSide = side;
  windowVisualState = 'sliding-in';

  // Ensure the hidden class matches the desired side (no transition yet)
  appEl.classList.remove('app-hidden-left', 'app-hidden-right');
  appEl.classList.add(side === 'left' ? 'app-hidden-left' : 'app-hidden-right');
  appEl.classList.add('app-no-transition');
  void appEl.offsetHeight; // force reflow

  // Enable transitions, then remove hidden → content slides in
  appEl.classList.remove('app-no-transition');
  void appEl.offsetHeight; // force reflow
  appEl.classList.remove('app-hidden-left', 'app-hidden-right');

  const onEnd = (e: TransitionEvent): void => {
    if (e.target !== appEl || e.propertyName !== 'transform') return;
    if (slideTransitionId !== myId) return;
    appEl.removeEventListener('transitionend', onEnd);
    windowVisualState = 'visible';
  };
  appEl.addEventListener('transitionend', onEnd);

  // Fallback: mark visible after duration even if transitionend doesn't fire
  setTimeout(() => {
    if (slideTransitionId === myId && windowVisualState === 'sliding-in') {
      windowVisualState = 'visible';
    }
  }, 150);
}

function slideOut(callback?: () => void): void {
  // If already hidden or the window is in canvas/expanded mode, hide immediately
  if (windowVisualState === 'hidden') {
    intentAPI.hideWindow();
    callback?.();
    return;
  }

  slideTransitionId++;
  const myId = slideTransitionId;
  windowVisualState = 'sliding-out';

  // Add hidden class → transition fires, content slides out
  appEl.classList.add(windowSide === 'left' ? 'app-hidden-left' : 'app-hidden-right');

  const finish = (): void => {
    if (slideTransitionId !== myId) return;
    windowVisualState = 'hidden';
    intentAPI.hideWindow();
    callback?.();
  };

  const onEnd = (e: TransitionEvent): void => {
    if (e.target !== appEl || e.propertyName !== 'transform') return;
    if (slideTransitionId !== myId) return;
    appEl.removeEventListener('transitionend', onEnd);
    clearTimeout(fallback);
    finish();
  };
  appEl.addEventListener('transitionend', onEnd);

  // Fallback timer in case transitionend doesn't fire
  const fallback = setTimeout(() => {
    appEl.removeEventListener('transitionend', onEnd);
    finish();
  }, 150);
}

// ── Status bar helpers ──────────────────────────────────
function showStatus(msg: string, isError = false): void {
  statusBar.textContent = msg;
  statusBar.classList.remove('hidden', 'error');
  if (isError) statusBar.classList.add('error');
}

function hideStatus(): void {
  statusBar.classList.add('hidden');
}

// ── Workers badge ───────────────────────────────────────
function updateWorkersBadge(): void {
  if (agentApprovals.size > 0 && currentFilter !== 'agents') {
    workersBadge.classList.remove('hidden');
  } else {
    workersBadge.classList.add('hidden');
  }
}

// ── Filter bar ──────────────────────────────────────────

function getPlaceholderForFilter(filter: typeof currentFilter): string {
  switch (filter) {
    case 'agents': return 'What should an agent work on?';
    case 'skills': return 'Describe a skill to create...';
    default: return 'What needs to get done?';
  }
}

function getSearchPlaceholderForFilter(filter: typeof currentFilter): string {
  switch (filter) {
    case 'agents': return '🔍 Search agents...';
    case 'skills': return '🔍 Search skills...';
    default: return '🔍 Search intents...';
  }
}


function updatePromptHint(): void {
  // Hint is now shown as placeholder text in the textarea
}

function setFilter(filter: typeof currentFilter): void {
  if (filter === currentFilter) return;
  currentFilter = filter;
  filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = filterBar.querySelector(`[data-filter="${filter}"]`) as HTMLElement;
  if (btn) btn.classList.add('active');

  // Show capture form on Spaces, Workers, and Skills; hide on Past
  if (filter === 'closed') {
    form.style.display = 'none';
  } else {
    form.style.display = '';
    descInput.placeholder = getPlaceholderForFilter(filter);
  }

  // Agents tab shows the summary panel; all others hide it
  if (filter === 'agents') {
    agentSummaryEl.classList.remove('hidden');
  } else {
    agentSummaryEl.classList.add('hidden');
  }

  // Old new-agent button is replaced by the prompt box
  newAgentBtn.classList.add('hidden');
  launchCliBtn.classList.add('hidden');

  // Exit search mode when switching tabs
  if (searchMode) {
    exitSearchMode();
  }

  updatePromptHint();
  updateWorkersBadge();
  render();
}

function focusActiveFilter(): void {
  const btn = filterBar.querySelector('.filter-btn.active') as HTMLElement;
  if (btn) btn.focus();
}

filterBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.filter-btn') as HTMLElement;
  if (!btn) return;
  const filter = btn.dataset.filter as typeof currentFilter;
  setFilter(filter);
});

filterBar.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const idx = filterOrder.indexOf(currentFilter);
    const next = e.key === 'ArrowRight'
      ? filterOrder[(idx + 1) % filterOrder.length]
      : filterOrder[(idx - 1 + filterOrder.length) % filterOrder.length];
    setFilter(next);
    focusActiveFilter();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    descInput.focus();
    return;
  }
});

// ── New Agent button ────────────────────────────────────
newAgentBtn.addEventListener('click', () => {
  openAgentChat(undefined as any, '', 'new');
});

newAgentBtn.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    focusActiveFilter();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    const items = listEl.querySelectorAll('.agent-card');
    if (items.length > 0) {
      selectedIndex = 0;
      updateAgentSelection();
      newAgentBtn.blur();
    }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    openAgentChat(undefined as any, '', 'new');
    return;
  }
});

// ── Launch CLI button ───────────────────────────────────
launchCliBtn.addEventListener('click', async () => {
  const result = await intentAPI.launchCliSession();
  if (result && 'error' in result) {
    console.error('[app] CLI launch failed:', result.error);
  } else {
    // Refresh agents list
    if (currentFilter === 'agents') renderAgentsList();
  }
});

// ── Settings modal ──────────────────────────────────────
let settingsModalOpen = false;

function showSettings(): void {
  // Open settings in a separate window
  intentAPI.openSettingsWindow();
}

function hideSettings(): void {
  settingsOverlay.classList.add('hidden');
  settingsModalOpen = false;
  settingsBtn.classList.remove('active');
  descInput.focus();
}

settingsBtn.addEventListener('click', showSettings);
settingsClose.addEventListener('click', hideSettings);
settingsBackdrop.addEventListener('click', hideSettings);

// ── Pin toggle ──────────────────────────────────────────
pinBtn.addEventListener('click', async () => {
  const current = pinBtn.classList.contains('active');
  const next = !current;
  intentAPI.setPinned(next);
  pinBtn.classList.toggle('active', next);
  pinBtn.title = next ? 'Unpin window' : 'Pin window (keep visible)';
});

intentAPI.onPinnedChanged((pinned: boolean) => {
  pinBtn.classList.toggle('active', pinned);
  pinBtn.title = pinned ? 'Unpin window' : 'Pin window (keep visible)';
});

async function loadPinState(): Promise<void> {
  const pinned = await intentAPI.getPinned();
  pinBtn.classList.toggle('active', pinned);
  pinBtn.title = pinned ? 'Unpin window' : 'Pin window (keep visible)';
}

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
  intentAPI.notifyCanvasThemeChanged('light');
});

themeDarkBtn.addEventListener('click', async () => {
  await intentAPI.setSetting('theme', 'dark');
  applyTheme('dark');
  intentAPI.notifyCanvasThemeChanged('dark');
});

async function loadWorkspaceSetting(): Promise<void> {
  const ws = await intentAPI.getSetting('workspace_root');
  updateWorkspaceDisplay(ws);
}

// ── Agent Personas ──────────────────────────────────────
const personasList = document.getElementById('personas-list') as HTMLDivElement;
const personaAddBtn = document.getElementById('persona-add-btn') as HTMLButtonElement;
let personas: AgentPersona[] = [];
let personaModels: { id: string; name?: string }[] = [];

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

async function loadPersonas(): Promise<void> {
  personas = await intentAPI.listPersonas() || [];
  try { personaModels = await intentAPI.listModels(); } catch { personaModels = []; }
  renderPersonas();
}

function renderPersonas(): void {
  // Preserve any open form so async re-renders don't destroy it
  const openForm = personasList.querySelector('.persona-form');
  personasList.innerHTML = '';
  for (const persona of personas) {
    personasList.appendChild(createPersonaCard(persona));
  }
  if (openForm) personasList.appendChild(openForm);
}

function createPersonaCard(persona: AgentPersona): HTMLElement {
  const card = document.createElement('div');
  card.className = 'persona-card';

  const info = document.createElement('div');
  info.className = 'persona-card-info';

  const handle = document.createElement('div');
  handle.className = 'persona-card-handle';
  handle.textContent = '@' + persona.handle;

  const instr = document.createElement('div');
  instr.className = 'persona-card-instructions';
  instr.textContent = persona.instructions.length > 80
    ? persona.instructions.slice(0, 77) + '...'
    : persona.instructions;

  const modelName = personaModels.find(m => m.id === persona.model);
  const meta = document.createElement('div');
  meta.className = 'persona-card-meta';
  const locationIcon = persona.runLocation === 'cloud' ? '☁️' : '💻';
  const locationLabel = persona.runLocation === 'cloud' ? 'Cloud' : 'Local';
  meta.textContent = (modelName ? (modelName.name || modelName.id) : (persona.model || 'Default model')) + ` · ${locationIcon} ${locationLabel}`;
  if (persona.sandboxed) {
    meta.textContent += ' · 🔒 Sandboxed';
  }
  if (persona.model && !modelName) {
    meta.classList.add('unavailable');
    meta.textContent = persona.model + ` (unavailable) · ${locationIcon} ${locationLabel}`;
    if (persona.sandboxed) meta.textContent += ' · 🔒 Sandboxed';
  }

  info.appendChild(handle);
  info.appendChild(instr);
  info.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'persona-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'persona-action-btn';
  editBtn.textContent = '✎';
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => showPersonaForm(persona));

  const delBtn = document.createElement('button');
  delBtn.className = 'persona-action-btn danger';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', async () => {
    personas = personas.filter(p => p.id !== persona.id);
    await intentAPI.savePersonas(personas);
    renderPersonas();
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

function showPersonaForm(existing?: AgentPersona): void {
  // Remove any open form
  const prev = personasList.querySelector('.persona-form');
  if (prev) prev.remove();

  const form = document.createElement('div');
  form.className = 'persona-form';

  // Handle input
  const handleRow = document.createElement('div');
  handleRow.className = 'persona-form-row';
  const handleLabel = document.createElement('label');
  handleLabel.textContent = '@';
  handleLabel.className = 'persona-handle-prefix';
  const handleInput = document.createElement('input');
  handleInput.type = 'text';
  handleInput.className = 'persona-form-input';
  handleInput.placeholder = 'handle';
  handleInput.value = existing?.handle || '';
  handleInput.maxLength = 32;
  handleRow.appendChild(handleLabel);
  handleRow.appendChild(handleInput);

  // Instructions textarea
  const instrRow = document.createElement('div');
  instrRow.className = 'persona-form-row';
  const instrInput = document.createElement('textarea');
  instrInput.className = 'persona-form-textarea';
  instrInput.placeholder = 'Instructions for this persona...';
  instrInput.value = existing?.instructions || '';
  instrInput.rows = 3;
  instrInput.maxLength = 2000;
  instrRow.appendChild(instrInput);

  // Model dropdown
  const modelRow = document.createElement('div');
  modelRow.className = 'persona-form-row';
  const modelLabel = document.createElement('label');
  modelLabel.textContent = 'Model';
  modelLabel.className = 'persona-form-label';
  const modelSelect = document.createElement('select');
  modelSelect.className = 'persona-form-select';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default';
  modelSelect.appendChild(defaultOpt);

  for (const m of personaModels) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name || m.id;
    if (m.id === existing?.model) opt.selected = true;
    modelSelect.appendChild(opt);
  }

  modelRow.appendChild(modelLabel);
  modelRow.appendChild(modelSelect);

  // Run location dropdown (local vs cloud)
  const locationRow = document.createElement('div');
  locationRow.className = 'persona-form-row';
  const locationLabel = document.createElement('label');
  locationLabel.textContent = 'Run location';
  locationLabel.className = 'persona-form-label';
  const locationSelect = document.createElement('select');
  locationSelect.className = 'persona-form-select';
  const localOpt = document.createElement('option');
  localOpt.value = 'local';
  localOpt.textContent = '💻 Local';
  const cloudOpt = document.createElement('option');
  cloudOpt.value = 'cloud';
  cloudOpt.textContent = '☁️ Cloud (GitHub CCA)';
  locationSelect.appendChild(localOpt);
  locationSelect.appendChild(cloudOpt);
  if (existing?.runLocation === 'cloud') cloudOpt.selected = true;
  locationRow.appendChild(locationLabel);
  locationRow.appendChild(locationSelect);

  // Sandbox checkbox (Windows-only, local-only)
  const isWindows = intentAPI.getPlatform() === 'win32';
  const sandboxRow = document.createElement('div');
  sandboxRow.className = 'persona-form-row persona-sandbox-row';
  if (!isWindows || (existing?.runLocation === 'cloud')) {
    sandboxRow.style.display = 'none';
  }
  const sandboxLabel = document.createElement('label');
  sandboxLabel.className = 'persona-form-checkbox-label';
  const sandboxCheck = document.createElement('input');
  sandboxCheck.type = 'checkbox';
  sandboxCheck.checked = existing?.sandboxed === true;
  sandboxLabel.appendChild(sandboxCheck);
  sandboxLabel.appendChild(document.createTextNode(' 🔒 Run in sandbox (restrict writes & dangerous commands)'));
  if (!isWindows) {
    sandboxLabel.title = 'Sandbox is only available on Windows';
  }
  sandboxRow.appendChild(sandboxLabel);

  // Show/hide sandbox when location changes
  locationSelect.addEventListener('change', () => {
    if (locationSelect.value === 'cloud' || !isWindows) {
      sandboxRow.style.display = 'none';
      sandboxCheck.checked = false;
    } else {
      sandboxRow.style.display = '';
    }
  });

  // Error display
  const errorEl = document.createElement('div');
  errorEl.className = 'persona-form-error hidden';

  // Action buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'persona-form-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'persona-form-save';
  saveBtn.textContent = existing ? 'Save' : 'Add';
  saveBtn.addEventListener('click', async () => {
    const rawHandle = handleInput.value.trim().replace(/^@/, '').toLowerCase();
    const instructions = instrInput.value.trim();
    const model = modelSelect.value;
    const runLocation = locationSelect.value as 'local' | 'cloud';
    const sandboxed = sandboxCheck.checked && runLocation === 'local';

    // Validate
    if (!HANDLE_RE.test(rawHandle)) {
      errorEl.textContent = 'Handle must be 1-32 lowercase letters, numbers, or dashes.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!instructions) {
      errorEl.textContent = 'Instructions are required.';
      errorEl.classList.remove('hidden');
      return;
    }
    // Check uniqueness (excluding self when editing)
    const duplicate = personas.find(p => p.handle === rawHandle && p.id !== (existing?.id || ''));
    if (duplicate) {
      errorEl.textContent = `Handle @${rawHandle} is already taken.`;
      errorEl.classList.remove('hidden');
      return;
    }

    if (existing) {
      // Update existing
      personas = personas.map(p => p.id === existing.id
        ? { ...p, handle: rawHandle, instructions, model, runLocation, ...(sandboxed ? { sandboxed: true } : { sandboxed: undefined }) }
        : p
      );
    } else {
      // Add new
      personas.push({
        id: crypto.randomUUID(),
        handle: rawHandle,
        instructions,
        model,
        runLocation,
        ...(sandboxed ? { sandboxed: true } : {}),
      });
    }

    await intentAPI.savePersonas(personas);
    renderPersonas();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'persona-form-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => form.remove());

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  form.appendChild(handleRow);
  form.appendChild(instrRow);
  form.appendChild(modelRow);
  form.appendChild(locationRow);
  form.appendChild(sandboxRow);
  form.appendChild(errorEl);
  form.appendChild(btnRow);

  if (existing) {
    // Insert form after the card being edited
    const cards = personasList.querySelectorAll('.persona-card');
    const idx = personas.findIndex(p => p.id === existing.id);
    if (cards[idx]) {
      cards[idx].after(form);
    } else {
      personasList.appendChild(form);
    }
  } else {
    personasList.appendChild(form);
  }

  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  handleInput.focus();
}

personaAddBtn.addEventListener('click', () => showPersonaForm());

// ── MCP Servers ─────────────────────────────────────────
const mcpDiscoveredList = document.getElementById('mcp-discovered-list') as HTMLDivElement;
const mcpCustomList = document.getElementById('mcp-custom-list') as HTMLDivElement;
const mcpAddBtn = document.getElementById('mcp-add-btn') as HTMLButtonElement;
let customMcpServers: CustomMcpServer[] = [];

async function loadMcpServers(): Promise<void> {
  // Load discovered MCPs
  try {
    const discovered: DiscoveredMcpServer[] = await intentAPI.listDiscoveredMcp();
    mcpDiscoveredList.innerHTML = '';
    for (const s of discovered) {
      mcpDiscoveredList.appendChild(createMcpCard(s, true));
    }
  } catch { mcpDiscoveredList.innerHTML = ''; }

  // Load custom MCPs
  try {
    customMcpServers = await intentAPI.listCustomMcp() || [];
    renderCustomMcpServers();
  } catch { customMcpServers = []; }
}

function renderCustomMcpServers(): void {
  mcpCustomList.innerHTML = '';
  for (const s of customMcpServers) {
    mcpCustomList.appendChild(createMcpCard(s, false));
  }
}

function createMcpCard(server: DiscoveredMcpServer | CustomMcpServer, isDiscovered: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mcp-card';

  const info = document.createElement('div');
  info.className = 'mcp-card-info';

  const name = document.createElement('div');
  name.className = 'mcp-card-name';
  name.textContent = (server as any).name;

  const meta = document.createElement('div');
  meta.className = 'mcp-card-meta';
  const type = (server as any).type || 'stdio';
  const detail = type === 'http' || type === 'sse'
    ? ((server as any).url || '')
    : ((server as any).command || '');
  meta.textContent = `${type}${detail ? ' · ' + detail : ''}`;

  if (isDiscovered) {
    const source = document.createElement('span');
    source.className = 'mcp-card-source';
    source.textContent = (server as DiscoveredMcpServer).source === 'plugin' ? ' (plugin)' : ' (config)';
    meta.appendChild(source);
  }

  info.appendChild(name);
  info.appendChild(meta);
  card.appendChild(info);

  if (!isDiscovered) {
    const delBtn = document.createElement('button');
    delBtn.className = 'persona-action-btn danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove';
    delBtn.addEventListener('click', async () => {
      customMcpServers = customMcpServers.filter(s => s.name !== (server as CustomMcpServer).name);
      await intentAPI.saveCustomMcp(customMcpServers);
      renderCustomMcpServers();
    });
    card.appendChild(delBtn);
  }

  return card;
}

function showMcpForm(): void {
  const prev = mcpCustomList.querySelector('.mcp-form');
  if (prev) prev.remove();

  const form = document.createElement('div');
  form.className = 'persona-form';

  // Name
  const nameRow = document.createElement('div');
  nameRow.className = 'persona-form-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'persona-form-input';
  nameInput.placeholder = 'Server name';
  nameRow.appendChild(nameInput);

  // Type select
  const typeRow = document.createElement('div');
  typeRow.className = 'persona-form-row';
  const typeLabel = document.createElement('label');
  typeLabel.className = 'persona-form-label';
  typeLabel.textContent = 'Type';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'persona-form-select';
  for (const t of ['stdio', 'http', 'sse']) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  }
  typeRow.appendChild(typeLabel);
  typeRow.appendChild(typeSelect);

  // Command (for stdio)
  const cmdRow = document.createElement('div');
  cmdRow.className = 'persona-form-row';
  const cmdInput = document.createElement('input');
  cmdInput.type = 'text';
  cmdInput.className = 'persona-form-input';
  cmdInput.placeholder = 'Command (e.g., npx -y @modelcontextprotocol/server-github)';
  cmdRow.appendChild(cmdInput);

  // URL (for http/sse)
  const urlRow = document.createElement('div');
  urlRow.className = 'persona-form-row hidden';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'persona-form-input';
  urlInput.placeholder = 'URL (e.g., http://localhost:3000/mcp)';
  urlRow.appendChild(urlInput);

  typeSelect.addEventListener('change', () => {
    const isRemote = typeSelect.value === 'http' || typeSelect.value === 'sse';
    cmdRow.classList.toggle('hidden', isRemote);
    urlRow.classList.toggle('hidden', !isRemote);
  });

  // Error
  const errorEl = document.createElement('div');
  errorEl.className = 'persona-form-error hidden';

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'persona-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'persona-form-save';
  saveBtn.textContent = 'Add';
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const type = typeSelect.value as 'stdio' | 'http' | 'sse';
    const command = cmdInput.value.trim();
    const url = urlInput.value.trim();

    if (!name) {
      errorEl.textContent = 'Name is required.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (customMcpServers.some(s => s.name === name)) {
      errorEl.textContent = 'A server with this name already exists.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (type === 'stdio' && !command) {
      errorEl.textContent = 'Command is required for stdio servers.';
      errorEl.classList.remove('hidden');
      return;
    }
    if ((type === 'http' || type === 'sse') && !url) {
      errorEl.textContent = 'URL is required for remote servers.';
      errorEl.classList.remove('hidden');
      return;
    }

    const entry: CustomMcpServer = {
      name,
      type,
      tools: ['*'],
      ...(type === 'stdio' ? { command, args: [] } : { url }),
    };

    customMcpServers.push(entry);
    await intentAPI.saveCustomMcp(customMcpServers);
    renderCustomMcpServers();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'persona-form-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => form.remove());

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  form.appendChild(nameRow);
  form.appendChild(typeRow);
  form.appendChild(cmdRow);
  form.appendChild(urlRow);
  form.appendChild(errorEl);
  form.appendChild(btnRow);

  mcpCustomList.appendChild(form);
  nameInput.focus();
}

mcpAddBtn.addEventListener('click', showMcpForm);

// ── CLI Tools ───────────────────────────────────────────
const cliToolsList = document.getElementById('cli-tools-list') as HTMLDivElement;
const cliToolAddBtn = document.getElementById('cli-tool-add-btn') as HTMLButtonElement;
let cliTools: CliToolDefinition[] = [];

async function loadCliTools(): Promise<void> {
  try {
    cliTools = await intentAPI.listCliTools() || [];
    renderCliTools();
  } catch { cliTools = []; }
}

function renderCliTools(): void {
  cliToolsList.innerHTML = '';
  for (const tool of cliTools) {
    cliToolsList.appendChild(createCliToolCard(tool));
  }
}

function createCliToolCard(tool: CliToolDefinition): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mcp-card';

  const info = document.createElement('div');
  info.className = 'mcp-card-info';

  const name = document.createElement('div');
  name.className = 'mcp-card-name';
  name.textContent = tool.name;

  const desc = document.createElement('div');
  desc.className = 'mcp-card-meta';
  desc.textContent = tool.description;

  info.appendChild(name);
  info.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'persona-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'persona-action-btn';
  editBtn.textContent = '✎';
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => showCliToolForm(tool));

  const delBtn = document.createElement('button');
  delBtn.className = 'persona-action-btn danger';
  delBtn.textContent = '✕';
  delBtn.title = 'Remove';
  delBtn.addEventListener('click', async () => {
    cliTools = cliTools.filter(t => t.name !== tool.name);
    await intentAPI.saveCliTools(cliTools);
    renderCliTools();
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

function showCliToolForm(existing?: CliToolDefinition): void {
  const prev = cliToolsList.querySelector('.persona-form');
  if (prev) prev.remove();

  const form = document.createElement('div');
  form.className = 'persona-form';

  const nameRow = document.createElement('div');
  nameRow.className = 'persona-form-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'persona-form-input';
  nameInput.placeholder = 'Command name (e.g., gh)';
  nameInput.value = existing?.name || '';
  nameRow.appendChild(nameInput);

  const descRow = document.createElement('div');
  descRow.className = 'persona-form-row';
  const descInput = document.createElement('textarea');
  descInput.className = 'persona-form-textarea';
  descInput.placeholder = 'Description (e.g., Used for GitHub operations including git, issues, pull requests, actions)';
  descInput.value = existing?.description || '';
  descInput.rows = 2;
  descInput.maxLength = 500;
  descRow.appendChild(descInput);

  const errorEl = document.createElement('div');
  errorEl.className = 'persona-form-error hidden';

  const btnRow = document.createElement('div');
  btnRow.className = 'persona-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'persona-form-save';
  saveBtn.textContent = existing ? 'Save' : 'Add';
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();

    if (!name) {
      errorEl.textContent = 'Command name is required.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!description) {
      errorEl.textContent = 'Description is required.';
      errorEl.classList.remove('hidden');
      return;
    }
    const duplicate = cliTools.find(t => t.name === name && t.name !== (existing?.name || ''));
    if (duplicate) {
      errorEl.textContent = `Tool "${name}" already exists.`;
      errorEl.classList.remove('hidden');
      return;
    }

    if (existing) {
      cliTools = cliTools.map(t => t.name === existing.name ? { name, description } : t);
    } else {
      cliTools.push({ name, description });
    }

    await intentAPI.saveCliTools(cliTools);
    renderCliTools();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'persona-form-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => form.remove());

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  form.appendChild(nameRow);
  form.appendChild(descRow);
  form.appendChild(errorEl);
  form.appendChild(btnRow);

  if (existing) {
    const cards = cliToolsList.querySelectorAll('.mcp-card');
    const idx = cliTools.findIndex(t => t.name === existing.name);
    if (cards[idx]) {
      cards[idx].after(form);
    } else {
      cliToolsList.appendChild(form);
    }
  } else {
    cliToolsList.appendChild(form);
  }

  nameInput.focus();
}

cliToolAddBtn.addEventListener('click', () => showCliToolForm());

// ── Voice Input (spacebar-triggered) ────────────────────
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let isRecording = false;
let isStartingRecording = false;
let audioStream: MediaStream | null = null;

// Waveform visualizer state
let analyserCtx: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let animFrameId: number | null = null;

function startWaveform(stream: MediaStream): void {
  analyserCtx = new AudioContext();
  const source = analyserCtx.createMediaStreamSource(stream);
  analyserNode = analyserCtx.createAnalyser();
  analyserNode.fftSize = 256;
  analyserNode.smoothingTimeConstant = 0.7;
  source.connect(analyserNode);

  // Size canvas to match textarea dimensions
  const rect = descInput.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  waveformCanvas.width = rect.width * dpr;
  waveformCanvas.height = rect.height * dpr;
  waveformCanvas.style.height = `${rect.height}px`;

  const ctx = waveformCanvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = rect.height;
  const bufLen = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufLen);

  // Use ~40 bars centered in the canvas
  const barCount = 40;
  const barGap = 2;
  const totalBarWidth = w * 0.7;
  const barWidth = (totalBarWidth - barGap * (barCount - 1)) / barCount;
  const startX = (w - totalBarWidth) / 2;
  const isDark = document.body.classList.contains('dark');

  function draw(): void {
    analyserNode!.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < barCount; i++) {
      // Map bar index to frequency bin (skip very low frequencies)
      const binIndex = Math.floor((i + 2) * (bufLen * 0.6) / barCount);
      const val = dataArray[Math.min(binIndex, bufLen - 1)] / 255;
      const minBar = 3;
      const barH = Math.max(minBar, val * (h * 0.75));
      const x = startX + i * (barWidth + barGap);
      const y = (h - barH) / 2;

      const alpha = 0.4 + val * 0.6;
      ctx.fillStyle = isDark
        ? `rgba(248, 113, 113, ${alpha})`
        : `rgba(239, 68, 68, ${alpha})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
      ctx.fill();
    }

    animFrameId = requestAnimationFrame(draw);
  }

  animFrameId = requestAnimationFrame(draw);
}

function stopWaveform(): void {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (analyserCtx) {
    analyserCtx.close().catch(() => {});
    analyserCtx = null;
    analyserNode = null;
  }
}

async function startRecording(): Promise<void> {
  if (isStartingRecording) return;
  isStartingRecording = true;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stopWaveform();
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
    descInput.value = '';
    startWaveform(audioStream);
    setInputState('recording');
    showStatus('🎤 Listening... press space to stop');
    mediaRecorder.start();
  } catch (err: any) {
    console.error('Microphone error:', err);
    stopWaveform();
    audioStream?.getTracks().forEach(t => t.stop());
    audioStream = null;
    setInputState('idle');
    if (err.name === 'NotAllowedError') {
      showStatus('Microphone access denied', true);
    } else {
      showStatus(`Mic error: ${err.message}`, true);
    }
  } finally {
    isStartingRecording = false;
  }
}

function stopRecording(): void {
  isRecording = false;
  stopWaveform();
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

function setInputState(state: 'idle' | 'recording' | 'transcribing'): void {
  descInput.classList.remove('recording', 'transcribing');
  recordingIndicator.classList.add('hidden');
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement | null;

  switch (state) {
    case 'recording':
      descInput.classList.add('hidden');
      waveformCanvas.classList.remove('hidden');
      descInput.placeholder = 'Listening... press space to stop';
      inputHints.classList.add('hidden');
      if (submitBtn) submitBtn.style.display = 'none';
      break;
    case 'transcribing':
      waveformCanvas.classList.add('hidden');
      descInput.classList.remove('hidden');
      descInput.classList.add('transcribing');
      descInput.placeholder = 'Transcribing...';
      inputHints.classList.add('hidden');
      if (submitBtn) submitBtn.style.display = 'none';
      break;
    default:
      waveformCanvas.classList.add('hidden');
      descInput.classList.remove('hidden');
      descInput.placeholder = searchMode ? getSearchPlaceholderForFilter(currentFilter) : getPlaceholderForFilter(currentFilter);
      inputHints.classList.toggle('hidden', searchMode || descInput.value.length > 0);
      if (submitBtn) submitBtn.style.display = '';
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

// Show/hide input hints based on whether textarea has content
descInput.addEventListener('input', () => {
  inputHints.classList.toggle('hidden', descInput.value.length > 0);
});

// Live search: filter list when in search mode (supports all tabs)
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
  activeSearchQuery = query;

  if (!query) {
    searchResults = null;
    selectedIndex = -1;
    if (currentFilter === 'agents') renderAgentsList();
    else if (currentFilter === 'skills') renderSkillsList();
    else render();
    return;
  }

  searchTimeout = setTimeout(async () => {
    if (currentFilter === 'agents') {
      renderAgentsList(query);
    } else if (currentFilter === 'skills') {
      renderSkillsList(query);
    } else {
      searchResults = await intentAPI.searchIntents(query);
      selectedIndex = -1;
      render();
    }
  }, 150);
});

function enterSearchMode(): void {
  searchMode = true;
  descInput.classList.add('search-mode');
  descInput.placeholder = getSearchPlaceholderForFilter(currentFilter);
  descInput.value = '';
  descInput.style.height = 'auto';
  searchResults = null;
  activeSearchQuery = '';
  selectedIndex = -1;
  inputHints.classList.add('hidden');
  updatePromptHint();
  render();
  descInput.focus();
}

function exitSearchMode(): void {
  searchMode = false;
  descInput.classList.remove('search-mode');
  descInput.placeholder = getPlaceholderForFilter(currentFilter);
  descInput.value = '';
  descInput.style.height = 'auto';
  searchResults = null;
  activeSearchQuery = '';
  selectedIndex = -1;
  inputHints.classList.remove('hidden');
  updatePromptHint();
  render();
  descInput.focus();
}

// Spacebar handling on the textarea
descInput.addEventListener('keydown', (e) => {
  // Shift+Tab: toggle search mode on Spaces, Workers, and Skills tabs
  if (e.key === 'Tab' && e.shiftKey) {
    if (currentFilter === 'closed') return; // no search on Past tab
    e.preventDefault();
    if (searchMode) exitSearchMode();
    else enterSearchMode();
    return;
  }

  // Up arrow: go to filter bar (tabs are above the prompt now)
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    focusActiveFilter();
    return;
  }

  // Down arrow: go to list items below
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    if (currentFilter === 'agents') {
      const items = listEl.querySelectorAll('.agent-card');
      if (items.length > 0) {
        selectedIndex = 0;
        updateAgentSelection();
        descInput.blur();
      }
    } else if (currentFilter === 'skills') {
      const items = listEl.querySelectorAll('.skill-card');
      if (items.length > 0) {
        (items[0] as HTMLElement).focus();
        descInput.blur();
      }
    } else if (displayedIntents.length > 0) {
      selectedIndex = 0;
      updateSelection();
      descInput.blur();
    }
    return;
  }

  // In search mode, Enter selects the first result instead of creating
  if (e.key === 'Enter' && !e.shiftKey && searchMode) {
    e.preventDefault();
    if (currentFilter === 'agents' && renderedAgents.length > 0) {
      openAgentChat(renderedAgents[0].agentId, renderedAgents[0].selectedText, renderedAgents[0].status, (renderedAgents[0] as any).source);
    } else if (currentFilter === 'skills' && cachedSkills.length > 0) {
      const q = activeSearchQuery.toLowerCase();
      const match = q ? cachedSkills.find(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : cachedSkills[0];
      if (match) openSkillEditor(match.id);
    } else if (displayedIntents.length > 0) {
      openCanvas(displayedIntents[0].id);
    }
    return;
  }

  // Enter submits by default; Shift+Enter inserts newline
  if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    const text = descInput.value.trim();
    if (currentFilter === 'open' && !text) {
      createAndOpenCanvas();
    } else {
      form.requestSubmit();
    }
    return;
  }

  if (e.key === ' ' && !e.repeat) {
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

  // Build agents-per-intent map for Spaces view
  try {
    const allAgents = await intentAPI.listAllAgents();
    const map = new Map<string, Array<{ agentId: string; status: string; summary: string; selectedText: string; source?: string }>>();
    for (const agent of allAgents) {
      if (!agent.intentId || agent.intentId === '__workspace__') continue;
      if (!map.has(agent.intentId)) map.set(agent.intentId, []);
      map.get(agent.intentId)!.push({
        agentId: agent.agentId,
        status: agent.status,
        summary: agent.summary,
        selectedText: agent.selectedText,
        source: agent.source,
      });
    }
    agentsByIntent = map;
  } catch { /* skip */ }

  updateFocusBanner();
  render();
}

function render(): void {
  let displayList: Intent[];

  if (searchResults !== null) {
    // Search mode on Spaces — show search results directly
    displayList = searchResults;
  } else if (currentFilter === 'agents') {
    // Agents mode — render agent list (with search filter if active)
    renderAgentsList(searchMode ? activeSearchQuery || undefined : undefined);
    return;
  } else if (currentFilter === 'skills') {
    // Skills mode — render skills list (with search filter if active)
    renderSkillsList(searchMode ? activeSearchQuery || undefined : undefined);
    return;
  } else if (currentFilter === 'closed') {
    // Past mode — render card-based combined view
    renderPastView();
    return;
  } else {
    // Normal mode — open spaces
    displayList = intents.filter(i => i.status !== 'done');
  }
  displayedIntents = displayList;

  countEl.textContent = String(intents.filter(i => i.status !== 'done').length);

  if (displayList.length === 0) {
    const emptyMsg = searchResults !== null ? 'No matching intents.' :
                     currentFilter === 'open' ? 'No spaces yet. Type or speak one above.' :
                     'Nothing here.';
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

    // Agent data for this intent
    const intentAgents = agentsByIntent.get(intent.id) || [];
    const hasRunningAgents = intentAgents.some(a => a.status === 'running');
    const hasWaitingAgents = intentAgents.some(a => a.status === 'waiting-approval');
    const hasFailedAgents = intentAgents.some(a => a.status === 'failed');

    // Build agent mini-cards
    let agentsHtml = '';
    if (intentAgents.length > 0) {
      const agentCards = intentAgents.map(agent => {
        const isCloud = agent.source === 'cloud';
        const aIcon = isCloud ? '☁️' :
                      agent.status === 'running' ? '⚡' :
                      agent.status === 'waiting-approval' ? '⏳' :
                      agent.status === 'completed' ? '✓' :
                      '✗';
        const aClass = agent.status === 'running' ? (isCloud ? 'mini-agent-cloud' : 'mini-agent-running') :
                       agent.status === 'waiting-approval' ? 'mini-agent-waiting' :
                       agent.status === 'completed' ? 'mini-agent-completed' :
                       'mini-agent-failed';
        const aLabel = agent.selectedText.length > 50 ? agent.selectedText.slice(0, 47) + '...' : agent.selectedText;
        return `<div class="mini-agent ${aClass}" data-agent-id="${agent.agentId}" title="${escapeHtml(agent.selectedText)}">`
          + `<span class="mini-agent-icon">${aIcon}</span>`
          + `<span class="mini-agent-label">${escapeHtml(aLabel || agent.summary || 'Agent')}</span>`
          + `</div>`;
      }).join('');
      agentsHtml = `<div class="intent-agents">${agentCards}</div>`;
    }

    return `
    <div class="intent-item ${intent.status === 'done' ? 'done' : ''} ${isProcessing ? 'processing' : ''} ${isFocused ? 'focused' : ''} ${hasRunningAgents ? 'has-running-agents' : ''} ${hasWaitingAgents ? 'has-waiting-agents' : ''}" data-id="${intent.id}" onclick="openCanvas('${intent.id}', true)">
      <div class="intent-check ${intent.status === 'done' ? 'checked' : ''}"
           onclick="event.stopPropagation(); toggleStatus('${intent.id}')">${intent.status === 'done' ? '✓' : ''}</div>
      <div class="intent-content">
        <div class="intent-desc-row">
          <div class="intent-desc ${hasRunningAgents ? 'agent-active' : ''}">${escapeHtml(intent.description)}</div>
          <button class="intent-refresh-title" onclick="event.stopPropagation(); refreshIntentTitle('${intent.id}')" title="Generate title from canvas content">✨</button>
        </div>
        <div class="intent-meta">
          ${intent.client ? `<span>👤 ${escapeHtml(intent.client)}</span>` : ''}
          ${hasDue ? `<span class="due-badge ${dueInfo.overdue ? 'overdue' : ''}">📅 ${escapeHtml(dueInfo.text)}</span>` : ''}
          ${isRecurring ? '<span class="recurring-badge">↻</span>' : ''}
          ${isRunning ? '<span class="session-badge running">● running</span>' : intent.session_id ? '<span class="session-badge">○ session</span>' : ''}
          ${hasRunningAgents ? `<span class="session-badge running">⚡ ${intentAgents.filter(a => a.status === 'running').length} working</span>` : ''}
          ${hasWaitingAgents ? '<span class="session-badge agent-attention">⏳ needs attention</span>' : ''}
          ${hasFailedAgents ? '<span class="session-badge agent-failed-badge">✗ failed</span>' : ''}
          ${isProcessing ? '<span class="processing-badge">refining...</span>' : ''}
          <span>${timeAgo(intent.updated_at)}</span>
        </div>
        ${agentsHtml}
        <div class="recall-hint hidden" data-recall-for="${intent.id}"></div>
      </div>
      ${intent.status !== 'done' ? `<button class="intent-focus ${isFocused ? 'is-focused' : ''}" onclick="event.stopPropagation(); setFocus('${intent.id}')" title="${isFocused ? 'Unfocus' : 'Focus'}">🎯</button>` : ''}
      <button class="intent-launch ${intent.session_id ? 'has-session' : ''} ${isRunning ? 'is-running' : ''}" onclick="event.stopPropagation(); launchSession('${intent.id}')" title="${isRunning ? 'Switch to session' : intent.session_id ? 'Resume session' : 'Start session'}">▶</button>
      <button class="intent-delete" onclick="event.stopPropagation(); deleteIntent('${intent.id}')">✕</button>
    </div>
  `;
  }).join('');

  // Wire mini-agent click handlers to open chat directly
  listEl.querySelectorAll('.mini-agent[data-agent-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const agentId = (el as HTMLElement).dataset.agentId!;
      // Find the agent data
      for (const agents of agentsByIntent.values()) {
        const agent = agents.find(a => a.agentId === agentId);
        if (agent) {
          openAgentChat(agentId, agent.selectedText, agent.status, agent.source as any);
          return;
        }
      }
    });
  });

  if (selectedIndex >= displayedIntents.length) {
    selectedIndex = -1;
  }
  updateSelection();
}

async function renderPastView(): Promise<void> {
  const gen = ++renderGeneration;
  displayedIntents = [];
  countEl.textContent = String(intents.filter(i => i.status !== 'done').length);

  const closedIntents = intents.filter(i => i.status === 'done');

  // Load timeline events
  let events: any[] = [];
  try {
    events = await intentAPI.listEvents(200);
  } catch { /* skip */ }

  if (gen !== renderGeneration) return;

  // Build a map of events per intent
  const eventsByIntent = new Map<string, any[]>();
  for (const event of events) {
    const id = event.intent_id;
    if (!id) continue;
    if (!eventsByIntent.has(id)) eventsByIntent.set(id, []);
    eventsByIntent.get(id)!.push(event);
  }

  // Also gather orphan events (no matching closed intent)
  const closedIds = new Set(closedIntents.map(i => i.id));

  if (closedIntents.length === 0 && events.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="icon">📋</span>
        <span>No past activity yet.</span>
      </div>
    `;
    return;
  }

  // Sort closed intents newest first by completed_at or updated_at
  const sorted = [...closedIntents].sort((a, b) =>
    (b.completed_at || b.updated_at).localeCompare(a.completed_at || a.updated_at)
  );

  let html = '';

  for (const intent of sorted) {
    const intentEvents = eventsByIntent.get(intent.id) || [];
    // Sort events oldest first for step display
    intentEvents.sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));

    const hasSession = !!intent.session_id;
    const typeIcon = hasSession ? '▶' : intent.recurrence ? '↻' : '✓';
    const typeLabel = hasSession ? 'Session' : intent.recurrence ? 'Recurring' : 'Completed';
    const completedAgo = intent.completed_at ? timeAgo(intent.completed_at) : timeAgo(intent.updated_at);

    // Build activity steps from events
    let stepsHtml = '';
    if (intentEvents.length > 0) {
      const steps = intentEvents.slice(-5).map((ev: any) => {
        const evIcon = ev.event_type === 'completed' ? '✅' :
                       ev.event_type === 'recycled' ? '↻' :
                       ev.event_type === 'recurrence_dismissed' ? '✕' : '•';
        const evLabel = ev.event_type === 'completed' ? 'Completed' :
                        ev.event_type === 'recycled' ? 'Rescheduled' :
                        ev.event_type === 'recurrence_dismissed' ? 'Dismissed' :
                        ev.event_type;
        return `<div class="past-card-step"><span class="past-step-icon">${evIcon}</span><span>${evLabel}</span></div>`;
      });
      stepsHtml = `<div class="past-card-steps">${steps.join('<div class="past-step-connector"></div>')}</div>`;
    }

    html += `
      <div class="past-card" data-id="${intent.id}" onclick="openCanvas('${intent.id}', true)">
        <button class="past-card-restore" onclick="event.stopPropagation(); unarchiveIntent('${intent.id}')" title="Restore to Spaces">↺</button>
        <div class="past-card-type"><span class="past-type-icon">${typeIcon}</span> ${typeLabel}</div>
        <div class="past-card-title">${escapeHtml(intent.description)}</div>
        ${intent.client ? `<div class="past-card-client">👤 ${escapeHtml(intent.client)}</div>` : ''}
        ${stepsHtml}
        <div class="past-card-meta">${completedAgo}</div>
      </div>
    `;
  }

  // Add orphan timeline events not tied to a closed intent
  const orphanEvents = events.filter(e => e.intent_id && !closedIds.has(e.intent_id));
  if (orphanEvents.length > 0) {
    // Group by date for context
    const groups = new Map<string, typeof orphanEvents>();
    for (const event of orphanEvents) {
      const date = new Date(event.created_at).toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric'
      });
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)!.push(event);
    }

    for (const [date, dateEvents] of groups) {
      html += `<div class="past-date-label">${date}</div>`;
      for (const event of dateEvents) {
        const icon = event.event_type === 'completed' ? '✅' :
                     event.event_type === 'recycled' ? '↻' : '•';
        const desc = event.intent_description ? escapeHtml(event.intent_description) : 'Unknown';
        const time = new Date(event.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        html += `
          <div class="past-card past-card-mini">
            <div class="past-card-type"><span class="past-type-icon">${icon}</span> ${escapeHtml(event.event_type)}</div>
            <div class="past-card-title">${desc}</div>
            <div class="past-card-meta">${time}</div>
          </div>
        `;
      }
    }
  }

  listEl.innerHTML = html;
}

function renderAgentSummary(agents: Array<{ status: string; createdAt?: string }>): void {
  const running = agents.filter(a => a.status === 'running' || a.status === 'waiting-approval').length;
  const completed = agents.filter(a => a.status === 'completed').length;
  const failed = agents.filter(a => a.status !== 'running' && a.status !== 'waiting-approval' && a.status !== 'completed').length;
  const openTasks = intents.filter(i => i.status !== 'done').length;
  const scheduled = intents.filter(i => i.due_at_utc || i.due_at).length;
  const recurring = intents.filter(i => i.recurrence).length;

  const lines: string[] = [];

  // Agent activity line
  if (agents.length === 0) {
    lines.push('No agents are active right now.');
  } else {
    const parts: string[] = [];
    if (running > 0) parts.push(`${running} ${running === 1 ? 'agent is' : 'agents are'} currently working`);
    if (completed > 0) parts.push(`${completed} recently completed`);
    if (failed > 0) parts.push(`${failed} need${failed === 1 ? 's' : ''} attention`);
    lines.push(parts.join(', and ') + '.');
  }

  // Tasks context line
  const taskParts: string[] = [];
  if (openTasks > 0) taskParts.push(`${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'}`);
  if (scheduled > 0) taskParts.push(`${scheduled} scheduled ${scheduled === 1 ? 'item' : 'items'} coming up`);
  if (recurring > 0) taskParts.push(`${recurring} recurring`);

  if (taskParts.length > 0) {
    lines.push('You have ' + taskParts.join(', and there\'s ') + '.');
  }

  agentSummaryEl.innerHTML = `
    <div class="agent-summary-header">
      <span class="summary-icon">✦</span>
      Summary
    </div>
    <div class="agent-summary-body">${lines.join('<br>')}</div>
  `;
}

// ── Agent step & approval tracking ────────────────────────
interface AgentStep {
  toolCallId: string;
  label: string;
  status: 'running' | 'done' | 'failed';
}
const agentSteps = new Map<string, AgentStep[]>();
const agentApprovals = new Map<string, { requestId: string; permissionKind: string; intention?: string; path?: string }>();
const agentChatUnsubs = new Map<string, () => void>();

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : filePath;
}

function humanizeToolName(toolName: string, args?: Record<string, any>): string {
  const fileName = args?.path ? basename(args.path) : '';

  if (toolName === 'report_intent' && args?.intent) {
    return String(args.intent).slice(0, 80);
  }
  if (toolName === 'edit' && fileName) return `Editing ${fileName}`;
  if (toolName === 'create' && fileName) return `Creating ${fileName}`;
  if (toolName === 'view' && fileName) return `Reading ${fileName}`;

  const map: Record<string, string> = {
    bash: 'Running command',
    edit: 'Editing file',
    create: 'Creating file',
    view: 'Reading file',
    grep: 'Searching code',
    glob: 'Finding files',
    web_fetch: 'Fetching web page',
    web_search: 'Searching the web',
    sql: 'Running query',
  };
  return map[toolName] || toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function subscribeAgentChat(agentId: string): void {
  if (agentChatUnsubs.has(agentId)) return;
  const unsub = intentAPI.onChatEvent(agentId, (event: any) => {
    if (event.type === 'tool.start') {
      const steps = agentSteps.get(agentId) || [];
      steps.push({
        toolCallId: event.toolCallId,
        label: humanizeToolName(event.toolName || 'Working', event.args),
        status: 'running',
      });
      agentSteps.set(agentId, steps);
      updateAgentCardSteps(agentId);
    } else if (event.type === 'tool.progress') {
      const steps = agentSteps.get(agentId);
      if (steps) {
        const step = steps.find(s => s.toolCallId === event.toolCallId);
        if (step && event.message) step.label = event.message;
        updateAgentCardSteps(agentId);
      }
    } else if (event.type === 'tool.complete') {
      const steps = agentSteps.get(agentId);
      if (steps) {
        const step = steps.find(s => s.toolCallId === event.toolCallId);
        if (step) step.status = event.success ? 'done' : 'failed';
        updateAgentCardSteps(agentId);
      }
    } else if (event.type === 'approval.needed') {
      agentApprovals.set(agentId, { requestId: event.requestId, permissionKind: event.permissionKind, intention: event.intention, path: event.path });
      updateAgentCardApproval(agentId);
    }
  });
  agentChatUnsubs.set(agentId, unsub);
}

function unsubscribeAllAgentChats(): void {
  for (const unsub of agentChatUnsubs.values()) unsub();
  agentChatUnsubs.clear();
}

function updateAgentCardSteps(agentId: string): void {
  const stepsEl = document.querySelector(`.agent-card[data-agent-id="${agentId}"] .agent-card-steps`);
  if (!stepsEl) return;
  const steps = agentSteps.get(agentId) || [];
  // Show last 6 steps max
  const visible = steps.slice(-6);
  stepsEl.innerHTML = visible.map((step, i) => {
    const icon = step.status === 'done' ? '<span class="step-icon step-done">✓</span>' :
                 step.status === 'failed' ? '<span class="step-icon step-failed">✗</span>' :
                 '<span class="step-icon step-running"></span>';
    const connector = i < visible.length - 1 ? '<div class="step-connector"></div>' : '';
    return `<div class="step-item">${icon}<span class="step-label">${escapeHtml(step.label)}</span></div>${connector}`;
  }).join('');
}

function describeApproval(approval: { permissionKind: string; intention?: string; path?: string }): { label: string; detail: string } {
  // Use the SDK's intention if available (e.g. "Read file: /path/to/file")
  let label: string;
  const kind = approval.permissionKind;
  if (kind.includes('file') || kind.includes('write')) label = 'Write to files';
  else if (kind.includes('bash') || kind.includes('exec') || kind.includes('command')) label = 'Execute a command';
  else if (kind.includes('read')) label = 'Read files';
  else label = kind.replace(/_/g, ' ');

  // Build a detail string with the specific path/intention
  let detail = '';
  if (approval.path) {
    const parts = approval.path.replace(/\\/g, '/').split('/').filter(Boolean);
    const shortPath = parts.length > 3
      ? '…/' + parts.slice(-3).join('/')
      : approval.path;
    detail = shortPath;
  } else if (approval.intention) {
    detail = approval.intention;
  }

  return { label, detail };
}

function updateAgentCardApproval(agentId: string): void {
  const card = document.querySelector(`.agent-card[data-agent-id="${agentId}"]`);
  if (!card) return;
  let approvalEl = card.querySelector('.agent-card-approval');
  const approval = agentApprovals.get(agentId);
  if (!approval) {
    if (approvalEl) approvalEl.remove();
    return;
  }
  if (!approvalEl) {
    approvalEl = document.createElement('div');
    approvalEl.className = 'agent-card-approval';
    card.appendChild(approvalEl);
  }
  const { label, detail } = describeApproval(approval);
  approvalEl.innerHTML = `
    <div class="approval-header">
      <span class="approval-icon">⚠️</span>
      <div class="approval-info">
        <span class="approval-label">Permission requested</span>
        <span class="approval-kind">${escapeHtml(label)}</span>
        ${detail ? `<span class="approval-detail">${escapeHtml(detail)}</span>` : ''}
      </div>
    </div>
    <div class="approval-actions">
      <button class="approval-btn approve" data-agent-id="${agentId}" data-request-id="${approval.requestId}">Approve</button>
      <button class="approval-btn deny" data-agent-id="${agentId}" data-request-id="${approval.requestId}">Deny</button>
    </div>
  `;
  approvalEl.querySelectorAll('.approval-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      const aid = el.dataset.agentId!;
      const rid = el.dataset.requestId!;
      const approved = el.classList.contains('approve');
      intentAPI.approveAgent(aid, rid, approved);
      agentApprovals.delete(aid);
      updateAgentCardApproval(aid);
    });
  });
}

// ── Skills rendering ────────────────────────────────────

interface SkillData {
  id: string;
  name: string;
  description: string;
  folder: string;
  filePath: string;
  created_at: string;
  updated_at: string;
}

let cachedSkills: SkillData[] = [];

async function loadSkills(): Promise<SkillData[]> {
  try {
    cachedSkills = await intentAPI.listSkills();
    return cachedSkills;
  } catch {
    return cachedSkills;
  }
}

async function renderSkillsList(filterQuery?: string): Promise<void> {
  const gen = ++renderGeneration;
  displayedIntents = [];
  countEl.textContent = String(intents.filter(i => i.status !== 'done').length);

  let skills = await loadSkills();

  if (gen !== renderGeneration) return;

  // Client-side filtering when in search mode
  if (filterQuery) {
    const q = filterQuery.toLowerCase();
    skills = skills.filter(s =>
      s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }

  if (skills.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="icon">🧩</span>
        <span>${filterQuery ? 'No matching skills.' : 'No skills yet. Describe a skill above to create one.'}</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = skills.map((skill, i) => `
    <div class="intent-item skill-card" data-skill-id="${skill.id}" tabindex="0" data-skill-index="${i}">
      <div class="skill-icon">${skill.emoji || '🧩'}</div>
      <div class="intent-content">
        <div class="intent-desc">${escapeHtml(skill.name)}</div>
        <div class="intent-meta">
          <span>${escapeHtml(skill.description.length > 100 ? skill.description.slice(0, 97) + '...' : skill.description)}</span>
        </div>
      </div>
      <button class="intent-launch" onclick="event.stopPropagation(); createIntentFromSkill('${skill.id}')" title="Launch as new space">▶</button>
      <button class="intent-launch" onclick="event.stopPropagation(); openSkillFolder('${skill.id}')" title="Open folder">📁</button>
      <button class="intent-delete" onclick="event.stopPropagation(); deleteSkill('${skill.id}')">✕</button>
    </div>
  `).join('');

  // Click + keyboard handler for skill cards
  listEl.querySelectorAll('.skill-card[data-skill-id]').forEach(el => {
    el.addEventListener('click', () => {
      const skillId = (el as HTMLElement).dataset.skillId!;
      openSkillEditor(skillId);
    });
    el.addEventListener('keydown', (e) => {
      const idx = parseInt((el as HTMLElement).dataset.skillIndex || '0', 10);
      const items = listEl.querySelectorAll('.skill-card');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (idx < items.length - 1) (items[idx + 1] as HTMLElement).focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx === 0) descInput.focus();
        else (items[idx - 1] as HTMLElement).focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openSkillEditor((el as HTMLElement).dataset.skillId!);
      }
    });
  });
}

async function createNewSkill(): Promise<void> {
  const name = prompt('Skill name:');
  if (!name || !name.trim()) return;

  const result = await intentAPI.createSkill(name.trim());
  if ('error' in result) {
    showStatus(`Failed: ${result.error}`, true);
    return;
  }
  showStatus(`✓ Created skill: ${result.name}`);
  setTimeout(hideStatus, 2000);
  render();
}

async function openSkillEditor(skillId: string): Promise<void> {
  const skill = cachedSkills.find(s => s.id === skillId);
  if (!skill) return;

  // In main window, always pop out to separate canvas window
  if (!isCanvasMode) {
    intentAPI.openCanvasWindow({ kind: 'skill', id: skillId, title: skill.name });
    return;
  }

  // ── Below runs only inside the canvas popout window ──
  const result = await intentAPI.readSkill(skillId);
  if ('error' in result) {
    return;
  }

  canvasIntentId = null;
  canvasSkillId = skillId;

  canvasTitle.textContent = skill.name;
  canvasTitle.contentEditable = 'false';
  canvasTitle.classList.remove('editing');
  canvasTitleAI.classList.add('hidden');
  canvasSaveStatus.textContent = '';
  canvasDirty = false;
  canvasSaveBtn.classList.add('hidden');
  updateModeToggleUI('rendered');

  // Show launch button for skills (creates workspace + launches session)
  canvasLaunchBtn.classList.remove('hidden');
  canvasLaunchBtn.title = 'Launch as new space';
  canvasAgentsBtn.classList.add('hidden');
  canvasHistoryBtn.classList.add('hidden');

  canvasView.classList.remove('hidden');

  const myGen = ++canvasMountGen;
  const currentTheme = await intentAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark');

  if (canvasMountGen !== myGen) return;

  // Pass frontmatter and body separately — canvas renders them independently
  mountCanvas(canvasRoot, {
    intentId: '__skill__' + skillId,
    content: result.body,
    frontmatter: result.frontmatter,
    theme: currentTheme,
    personas: [],
    onDirtyChange: (dirty: boolean) => {
      canvasDirty = dirty;
      canvasSaveBtn.classList.toggle('hidden', !dirty);
    },
    onSaveStatus: (status: string) => {
      canvasSaveStatus.textContent = status;
    },
    onAgentMentioned: () => {},
  });
}

async function saveSkillFromCanvas(skillId: string, content: string): Promise<void> {
  // Parse frontmatter using the same regex the main process uses
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let frontmatter: Record<string, unknown> = {};
  let body = content;

  if (fmMatch) {
    // Parse YAML key-value pairs, preserving non-string values
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        // Try to parse as JSON for arrays, booleans, numbers
        try {
          frontmatter[key] = JSON.parse(value);
        } catch {
          frontmatter[key] = value;
        }
      }
    }
    body = fmMatch[2];
  }

  await intentAPI.writeSkill(skillId, frontmatter, body);
}

async function openSkillFolder(skillId: string): Promise<void> {
  await intentAPI.openSkillFolder(skillId);
}

async function createIntentFromSkill(skillId: string): Promise<void> {
  const result = await intentAPI.createIntentFromSkill(skillId);
  if ('error' in result) {
    showStatus(`Failed: ${result.error}`, true);
    return;
  }
  showStatus(`✓ Created intent from skill`);
  setTimeout(hideStatus, 2000);
  // Refresh and switch to Spaces
  await refreshIntents();
  setFilter('open');
  openCanvas(result.id, true);
}

async function deleteSkill(skillId: string): Promise<void> {
  const skill = cachedSkills.find(s => s.id === skillId);
  if (!confirm(`Delete skill "${skill?.name || skillId}"?`)) return;

  await intentAPI.deleteSkill(skillId);
  render();
}

async function launchSkillAsIntent(skillId: string): Promise<void> {
  const result = await intentAPI.launchSkill(skillId);
  if ('error' in result) {
    showStatus(`Failed: ${result.error}`, true);
    return;
  }
  showStatus(`✓ Launched skill as new space`);
  setTimeout(hideStatus, 2000);
  await refreshIntents();
  setFilter('open');
  // Close the skill editor canvas if open in a popout
  if (isCanvasMode) {
    window.close();
  }
}

// Wire up skills changed event
intentAPI.onSkillsChanged(() => {
  if (currentFilter === 'skills') {
    renderSkillsList();
  }
});

// Expose skill functions to onclick handlers
(window as any).createNewSkill = createNewSkill;
(window as any).openSkillFolder = openSkillFolder;
(window as any).createIntentFromSkill = createIntentFromSkill;
(window as any).launchSkillAsIntent = launchSkillAsIntent;
(window as any).deleteSkill = deleteSkill;

async function renderAgentsList(filterQuery?: string): Promise<void> {
  const gen = ++renderGeneration;
  displayedIntents = [];
  countEl.textContent = String(intents.filter(i => i.status !== 'done').length);

  // Gather all agents (including workspace-level ones)
  let allAgents: Array<{ agentId: string; sessionId: string; status: string; summary: string; selectedText: string; intentId: string; createdAt?: string; pendingApprovalId?: string | null; pendingPermissionKind?: string | null; source?: 'sdk' | 'cli' | 'cloud' }> = [];

  try {
    allAgents = await intentAPI.listAllAgents();
  } catch {
    // Fallback: iterate intents
    for (const intent of intents) {
      try {
        const agents = await intentAPI.listAgents(intent.id);
        for (const agent of agents) {
          allAgents.push({ ...agent, intentId: intent.id });
        }
      } catch { /* skip */ }
    }
  }

  // Bail if user switched away from agents while loading
  if (gen !== renderGeneration) return;

  // Client-side filtering when in search mode
  if (filterQuery) {
    const q = filterQuery.toLowerCase();
    allAgents = allAgents.filter(a =>
      (a.selectedText || '').toLowerCase().includes(q) ||
      (a.summary || '').toLowerCase().includes(q)
    );
  }

  // Store for keyboard nav
  renderedAgents = allAgents;
  selectedIndex = -1;

  // Render the summary card (only when not filtering)
  if (!filterQuery) renderAgentSummary(allAgents);

  if (allAgents.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="icon">⚡</span>
        <span>${filterQuery ? 'No matching agents.' : 'No agents yet. Describe a task above to launch one.'}</span>
      </div>
    `;
    return;
  }

  // Sort newest first (DB returns this order, but be explicit)
  allAgents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Build intent description map for display
  const intentMap = new Map(intents.map(i => [i.id, i.description]));

  // Populate approvals from API data
  for (const agent of allAgents) {
    if (agent.status === 'waiting-approval' && agent.pendingApprovalId) {
      agentApprovals.set(agent.agentId, {
        requestId: agent.pendingApprovalId,
        permissionKind: agent.pendingPermissionKind || 'permission',
        intention: (agent as any).pendingIntention || undefined,
        path: (agent as any).pendingPath || undefined,
      });
    }
  }

  listEl.innerHTML = allAgents.map(agent => {
    const statusClass = agent.status === 'running' ? 'agent-running' :
                        agent.status === 'waiting-approval' ? 'agent-waiting' :
                        agent.status === 'completed' ? 'agent-completed' :
                        'agent-failed';

    const statusIcon = agent.source === 'cli'
      ? '🖥'
      : agent.source === 'cloud'
        ? '☁️'
        : agent.status === 'running' ? '<svg class="agent-icon-svg agent-icon-running" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" stroke="#a855f7" stroke-width="2" stroke-dasharray="12 38" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="0.8s" repeatCount="indefinite"/></circle><circle cx="9" cy="9" r="4" fill="#a855f7" opacity="0.3"/></svg>' :
                       agent.status === 'waiting-approval' ? '<svg class="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" fill="#f59e0b" opacity="0.15" stroke="#f59e0b" stroke-width="1.5"/><circle cx="9" cy="9" r="3.5" stroke="#f59e0b" stroke-width="1.5" fill="none"/><path d="M9 7V9.5L10.5 10.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' :
                       agent.status === 'completed' ? '<svg class="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#22c55e"/><path d="M5.5 9.5L7.8 11.8L12.5 6.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' :
                       '<svg class="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#ef4444"/><path d="M6 6L12 12M12 6L6 12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>';

    const intentLabel = agent.source === 'cli'
      ? 'CLI Session'
      : agent.source === 'cloud'
        ? 'Cloud Agent'
        : agent.intentId === '__workspace__'
          ? 'Workspace'
          : escapeHtml(intentMap.get(agent.intentId) || agent.intentId);

    const title = agent.selectedText.length > 80
      ? agent.selectedText.slice(0, 77) + '...'
      : agent.selectedText;

    // Build steps HTML (live steps if available, else just summary)
    const steps = agentSteps.get(agent.agentId) || [];
    const visible = steps.slice(-6);
    const stepsHtml = visible.length > 0 ? visible.map((step, i) => {
      const icon = step.status === 'done' ? '<span class="step-icon step-done"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5L4.2 7.5L8 3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' :
                   step.status === 'failed' ? '<span class="step-icon step-failed"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg></span>' :
                   '<span class="step-icon step-running"></span>';
      const connector = i < visible.length - 1 ? '<div class="step-connector"></div>' : '';
      return `<div class="step-item">${icon}<span class="step-label">${escapeHtml(step.label)}</span></div>${connector}`;
    }).join('') : (agent.status === 'running' ? `<div class="step-item"><span class="step-icon step-running"></span><span class="step-label">${escapeHtml(agent.summary)}</span></div>` : '');

    // Build approval HTML
    const approval = agentApprovals.get(agent.agentId);
    let approvalHtml = '';
    if (approval) {
      const { label, detail } = describeApproval(approval);
      approvalHtml = `
      <div class="agent-card-approval">
        <div class="approval-header">
          <span class="approval-icon">⚠️</span>
          <div class="approval-info">
            <span class="approval-label">Permission requested</span>
            <span class="approval-kind">${escapeHtml(label)}</span>
            ${detail ? `<span class="approval-detail">${escapeHtml(detail)}</span>` : ''}
          </div>
        </div>
        <div class="approval-actions">
          <button class="approval-btn approve" data-agent-id="${agent.agentId}" data-request-id="${approval.requestId}">Approve</button>
          <button class="approval-btn deny" data-agent-id="${agent.agentId}" data-request-id="${approval.requestId}">Deny</button>
        </div>
      </div>
    `;
    }

    const canvasBtn = agent.intentId && agent.intentId !== '__workspace__' && agent.source !== 'cli'
      ? `<button class="agent-card-canvas-btn" data-intent-id="${agent.intentId}" title="Open canvas">📄</button>`
      : '';

    return `
      <div class="agent-card ${statusClass}" data-agent-id="${agent.agentId}" title="Click to open chat">
        <div class="agent-card-header">
          <span class="agent-card-icon">${statusIcon}</span>
          <span class="agent-card-name">${intentLabel}</span>
          <div class="agent-card-actions">
            ${canvasBtn}
            <button class="agent-card-delete-btn" data-agent-id="${agent.agentId}" title="Delete session">✕</button>
          </div>
        </div>
        <div class="agent-card-title">${escapeHtml(title)}</div>
        ${stepsHtml ? `<div class="agent-card-steps">${stepsHtml}</div>` : ''}
        ${agent.status === 'completed' ? `<div class="agent-card-status-badge status-completed"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#22c55e"/><path d="M3.5 6.2L5.2 7.9L8.5 4.3" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Completed</div>` :
          agent.status === 'failed' ? `<div class="agent-card-status-badge status-failed"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#ef4444"/><path d="M4 4L8 8M8 4L4 8" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg> Failed</div>` : ''}
        ${(agent.status === 'completed' || agent.status === 'failed') && agent.summary ? `<div class="agent-card-summary">${escapeHtml(agent.summary)}</div>` : ''}
        ${approvalHtml}
      </div>
    `;
  }).join('');

  // Attach click handlers to open chat view
  listEl.querySelectorAll('.agent-card[data-agent-id]').forEach(el => {
    el.addEventListener('click', () => {
      const agentId = (el as HTMLElement).dataset.agentId;
      if (!agentId) return;
      const agent = allAgents.find(a => a.agentId === agentId);
      if (agent) {
        openAgentChat(agentId, agent.selectedText, agent.status, agent.source);
      }
    });
  });

  // Wire up approval button handlers
  listEl.querySelectorAll('.approval-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      const aid = el.dataset.agentId!;
      const rid = el.dataset.requestId!;
      const approved = el.classList.contains('approve');
      intentAPI.approveAgent(aid, rid, approved);
      agentApprovals.delete(aid);
      updateAgentCardApproval(aid);
    });
  });

  // Wire up delete session handlers
  listEl.querySelectorAll('.agent-card-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const aid = (e.currentTarget as HTMLElement).dataset.agentId!;
      await intentAPI.deleteAgentSession(aid);
      renderAgentsList();
    });
  });

  // Wire up canvas button handlers
  listEl.querySelectorAll('.agent-card-canvas-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const intentId = (e.currentTarget as HTMLElement).dataset.intentId!;
      openCanvas(intentId, true);
    });
  });

  // Subscribe to chat events for live agents
  for (const agent of allAgents) {
    if (agent.status === 'running' || agent.status === 'waiting-approval') {
      subscribeAgentChat(agent.agentId);
    }
  }
}

let renderedAgents: Array<{ agentId: string; sessionId: string; status: string; summary: string; selectedText: string; intentId: string; createdAt?: string }> = [];

function updateAgentSelection(): void {
  const items = listEl.querySelectorAll('.agent-card');
  items.forEach((item, i) => {
    item.classList.toggle('kb-selected', i === selectedIndex);
  });
  if (selectedIndex >= 0 && items[selectedIndex]) {
    (items[selectedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
  }
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

  // ── Workers tab: launch an agent ──────────────────────
  if (currentFilter === 'agents') {
    if (!text) {
      // Empty prompt → open new agent chat
      openAgentChat(undefined as any, '', 'new');
      return;
    }
    showStatus('⚡ Launching agent...');
    const result = await intentAPI.quickLaunchAgent(text);
    if ('error' in result && result.error) {
      if (result.error === 'no_workspace') {
        showStatus('Select a workspace directory first');
        const ws = await intentAPI.selectWorkspace();
        if (ws.selected) updateWorkspaceDisplay(ws.path!);
      } else {
        showStatus(`Failed: ${result.error}`, true);
      }
      return;
    }
    descInput.value = '';
    descInput.style.height = 'auto';
    descInput.focus();
    hideStatus();
    renderAgentsList();
    return;
  }

  // ── Skills tab: create a skill from description ───────
  if (currentFilter === 'skills') {
    if (!text) return; // require a description
    showStatus('✨ Creating skill...');
    const result = await intentAPI.createSkillFromPrompt(text);
    if ('error' in result && result.error) {
      if (result.error === 'no_workspace') {
        showStatus('Select a workspace directory first');
        const ws = await intentAPI.selectWorkspace();
        if (ws.selected) updateWorkspaceDisplay(ws.path!);
      } else {
        showStatus(`Failed: ${result.error}`, true);
      }
      return;
    }
    descInput.value = '';
    descInput.style.height = 'auto';
    descInput.focus();
    showStatus('✨ Creating skill...');
    setTimeout(hideStatus, 4000);
    return;
  }

  // ── Spaces tab: create an intent (original behavior) ──
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
const workspaceClearBtn = document.getElementById('workspace-clear-btn') as HTMLButtonElement;

function updateWorkspaceDisplay(path: string | null): void {
  if (path) {
    // Show last 2 path segments for brevity
    const parts = path.replace(/\\/g, '/').split('/');
    const short = parts.length > 2 ? '…/' + parts.slice(-2).join('/') : path;
    workspacePathEl.textContent = short;
    workspacePathEl.title = path;
    workspacePathEl.classList.add('clickable');
    workspaceClearBtn.classList.remove('hidden');
  } else {
    workspacePathEl.textContent = 'Not set';
    workspacePathEl.title = '';
    workspacePathEl.classList.remove('clickable');
    workspaceClearBtn.classList.add('hidden');
  }
}

workspaceBtn.addEventListener('click', async () => {
  const result = await intentAPI.selectWorkspace();
  if (result.selected) {
    updateWorkspaceDisplay(result.path);
  }
});

workspaceClearBtn.addEventListener('click', async () => {
  await intentAPI.clearWorkspace();
  updateWorkspaceDisplay(null);
});

workspacePathEl.addEventListener('click', () => {
  const path = workspacePathEl.title;
  if (path) {
    intentAPI.openPath(path);
  }
});

// ── CLI Path setting ────────────────────────────────────
const cliPathInput = document.getElementById('cli-path-input') as HTMLInputElement;
const cliPathClear = document.getElementById('cli-path-clear') as HTMLButtonElement;
const cliPathDetected = document.getElementById('cli-path-detected') as HTMLSpanElement;

async function loadCliPathSetting(): Promise<void> {
  const override = await intentAPI.getSetting('cli_path');
  const info = await intentAPI.checkCliVersion();

  cliPathInput.value = override || '';
  cliPathClear.classList.toggle('hidden', !override);

  if (!info.path) {
    cliPathDetected.textContent = 'Not found';
    cliPathDetected.title = '';
  } else if (!info.compatible) {
    cliPathDetected.textContent = `${info.path} (v${info.version || '?'} — update to ${info.minVersion}+)`;
    cliPathDetected.title = info.path;
    cliPathDetected.style.color = 'var(--color-warning, #d29922)';
  } else {
    cliPathDetected.textContent = `${info.path} (v${info.version})`;
    cliPathDetected.title = info.path;
    cliPathDetected.style.color = '';
  }
}

async function updateCliPathDetected(): Promise<void> {
  const info = await intentAPI.checkCliVersion();
  if (!info.path) {
    cliPathDetected.textContent = 'Not found';
    cliPathDetected.title = '';
    cliPathDetected.style.color = '';
  } else if (!info.compatible) {
    cliPathDetected.textContent = `${info.path} (v${info.version || '?'} — update to ${info.minVersion}+)`;
    cliPathDetected.title = info.path;
    cliPathDetected.style.color = 'var(--color-warning, #d29922)';
  } else {
    cliPathDetected.textContent = `${info.path} (v${info.version})`;
    cliPathDetected.title = info.path;
    cliPathDetected.style.color = '';
  }
}

let cliPathDebounce: ReturnType<typeof setTimeout> | null = null;
cliPathInput.addEventListener('input', () => {
  if (cliPathDebounce) clearTimeout(cliPathDebounce);
  cliPathDebounce = setTimeout(async () => {
    const val = cliPathInput.value.trim();
    await intentAPI.setSetting('cli_path', val);
    cliPathClear.classList.toggle('hidden', !val);
    await updateCliPathDetected();
  }, 500);
});

cliPathClear.addEventListener('click', async () => {
  cliPathInput.value = '';
  await intentAPI.setSetting('cli_path', '');
  cliPathClear.classList.add('hidden');
  await updateCliPathDetected();
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
  hideSettings();
  timelineView.classList.remove('hidden');
  loadTimeline();
}

function hideTimeline(): void {
  timelineView.classList.add('hidden');
  mainView.classList.remove('hidden');
  descInput.focus();
}

timelineBtn?.addEventListener('click', showTimeline);
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
  if (!confirm('Delete this space? Its folder and files will be permanently removed.')) return;
  await intentAPI.delete(id);
  await loadIntents();
}

(window as any).toggleStatus = toggleStatus;
(window as any).deleteIntent = deleteIntent;

// @ts-ignore - called from onclick in HTML
async function unarchiveIntent(id: string): Promise<void> {
  const result = await intentAPI.unarchive(id);
  if (result) {
    showStatus('✓ Restored to Spaces');
    setTimeout(hideStatus, 2000);
    await loadIntents();
  }
}

(window as any).unarchiveIntent = unarchiveIntent;

// @ts-ignore - called from onclick in HTML
async function refreshIntentTitle(id: string): Promise<void> {
  const btn = document.querySelector(`.intent-item[data-id="${id}"] .intent-refresh-title`) as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const { content } = await intentAPI.readCanvas(id);
    if (!content || !content.trim()) return;
    const result = await intentAPI.summarizeTitle(content);
    if (result.title) {
      await intentAPI.update(id, { description: result.title });
      await loadIntents();
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨'; }
  }
}

(window as any).refreshIntentTitle = refreshIntentTitle;

// ── Canvas view ─────────────────────────────────────────
import { mountCanvas, unmountCanvas, getCanvasContent, saveCanvas as saveCanvasEditor, updateCanvasPresence, addCanvasCommentReply, toggleCanvasMode, getCanvasEditorMode, replaceCanvasContent } from './canvas/mount.tsx';
import type { DocumentPresence } from 'documint';

const canvasView = document.getElementById('canvas-view') as HTMLDivElement;
const canvasBack = document.getElementById('canvas-back') as HTMLButtonElement;
const canvasTitle = document.getElementById('canvas-title') as HTMLHeadingElement;
const canvasTitleAI = document.getElementById('canvas-title-ai') as HTMLButtonElement;
const canvasSaveStatus = document.getElementById('canvas-save-status') as HTMLSpanElement;
const canvasLaunchBtn = document.getElementById('canvas-launch') as HTMLButtonElement;
const canvasSaveBtn = document.getElementById('canvas-save') as HTMLButtonElement;
const canvasRoot = document.getElementById('canvas-root') as HTMLDivElement;
const canvasHistoryBtn = document.getElementById('canvas-history-btn') as HTMLButtonElement;
const canvasHistoryPanel = document.getElementById('canvas-history-panel') as HTMLDivElement;
const canvasHistoryClose = document.getElementById('canvas-history-close') as HTMLButtonElement;
const canvasHistoryList = document.getElementById('canvas-history-list') as HTMLDivElement;
const canvasPreviewBanner = document.getElementById('canvas-preview-banner') as HTMLDivElement;
const canvasPreviewLabel = document.getElementById('canvas-preview-label') as HTMLSpanElement;
const canvasPreviewRestore = document.getElementById('canvas-preview-restore') as HTMLButtonElement;
const canvasPreviewBack = document.getElementById('canvas-preview-back') as HTMLButtonElement;
const canvasAgentsBtn = document.getElementById('canvas-agents-btn') as HTMLButtonElement;
const modeToggleRendered = document.getElementById('mode-toggle-rendered') as HTMLButtonElement;
const modeToggleRaw = document.getElementById('mode-toggle-raw') as HTMLButtonElement;
const canvasAgentsPanel = document.getElementById('canvas-agents-panel') as HTMLDivElement;
const canvasAgentsClose = document.getElementById('canvas-agents-close') as HTMLButtonElement;
const canvasAgentsList = document.getElementById('canvas-agents-list') as HTMLDivElement;
let canvasIntentId: string | null = null;
let canvasSkillId: string | null = null;
let canvasDirty = false;
let canvasIsNewIntent = false;
let canvasMountGen = 0;
let titleBeforeEdit = '';

function startEditingTitle(): void {
  titleBeforeEdit = canvasTitle.textContent || '';
  canvasTitle.contentEditable = 'true';
  canvasTitle.classList.add('editing');
  canvasTitleAI.classList.remove('hidden');
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(canvasTitle);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

async function commitTitleEdit(): Promise<void> {
  canvasTitle.contentEditable = 'false';
  canvasTitle.classList.remove('editing');
  canvasTitleAI.classList.add('hidden');
  const newTitle = (canvasTitle.textContent || '').trim();
  if (!newTitle) {
    canvasTitle.textContent = titleBeforeEdit;
  } else if (newTitle !== titleBeforeEdit && canvasIntentId) {
    canvasTitle.textContent = newTitle;
    await intentAPI.update(canvasIntentId, { description: newTitle });
    await loadIntents();
  }
}

function cancelTitleEdit(): void {
  canvasTitle.contentEditable = 'false';
  canvasTitle.classList.remove('editing');
  canvasTitleAI.classList.add('hidden');
  canvasTitle.textContent = titleBeforeEdit;
}

canvasTitle.addEventListener('click', () => {
  if (canvasTitle.contentEditable !== 'true') startEditingTitle();
});

canvasTitle.addEventListener('blur', (e) => {
  if ((e as FocusEvent).relatedTarget === canvasTitleAI) return;
  commitTitleEdit();
});

canvasTitle.addEventListener('keydown', (e) => {
  if (canvasTitle.contentEditable !== 'true') return;
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitTitleEdit(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelTitleEdit(); }
});

canvasTitleAI.addEventListener('click', async () => {
  if (!canvasIntentId) return;
  const content = getCanvasContent();
  if (!content.trim()) return;
  canvasTitleAI.disabled = true;
  canvasTitleAI.textContent = '⏳';
  try {
    const result = await intentAPI.summarizeTitle(content);
    if (result.title) {
      canvasTitle.textContent = result.title;
      canvasTitle.focus();
    }
  } finally {
    canvasTitleAI.disabled = false;
    canvasTitleAI.textContent = '✨';
  }
});

// Create a new blank intent and immediately open it in the full canvas editor
async function createAndOpenCanvas(): Promise<void> {
  const intent = await intentAPI.create({ body: '' }) as any;
  if (intent.error === 'no_workspace') {
    showStatus('Select a workspace directory first');
    const ws = await intentAPI.selectWorkspace();
    if (!ws.selected) { hideStatus(); return; }
    updateWorkspaceDisplay(ws.path!);
    const retry = await intentAPI.create({ body: '' }) as any;
    if (retry.error) { showStatus('Failed to create intent', true); return; }
    await loadIntents();
    openCanvas(retry.id, true);
    canvasIsNewIntent = true;
    return;
  }
  await loadIntents();
  openCanvas(intent.id, true);
  canvasIsNewIntent = true;
}

async function openCanvas(intentId: string, expanded = false): Promise<void> {
  const intent = intents.find(i => i.id === intentId);
  if (!intent) return;

  // In main window, always pop out to separate canvas window
  if (!isCanvasMode) {
    intentAPI.openCanvasWindow({ kind: 'intent', id: intentId, title: intent.description });
    return;
  }

  // ── Below runs only inside the canvas popout window ──
  canvasIntentId = intentId;
  canvasSkillId = null;
  canvasTitle.textContent = intent.description;
  canvasTitle.contentEditable = 'false';
  canvasTitle.classList.remove('editing');
  canvasTitleAI.classList.add('hidden');
  canvasSaveStatus.textContent = '';
  canvasDirty = false;
  canvasSaveBtn.classList.add('hidden');
  updateModeToggleUI('rendered');

  // Show intent-specific controls
  canvasLaunchBtn.classList.remove('hidden');
  canvasLaunchBtn.title = 'Start session';
  canvasAgentsBtn.classList.remove('hidden');
  canvasHistoryBtn.classList.remove('hidden');

  canvasView.classList.remove('hidden');

  const myGen = ++canvasMountGen;

  // Load all data in parallel
  const [result, currentTheme, canvasPersonas] = await Promise.all([
    intentAPI.readCanvas(intentId),
    intentAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark'),
    intentAPI.listPersonas().then(p => p || []),
  ]);

  // Abort if user already switched to another intent
  if (canvasMountGen !== myGen) return;

  if (result.error === 'no_workspace') {
    return;
  }

  // Mount Documint editor
  mountCanvas(canvasRoot, {
    intentId,
    content: result.content || '',
    theme: currentTheme,
    personas: canvasPersonas,
    onDirtyChange: (dirty: boolean) => {
      canvasDirty = dirty;
      canvasSaveBtn.classList.toggle('hidden', !dirty);
    },
    onSaveStatus: (status: string) => {
      canvasSaveStatus.textContent = status;
    },
    onAgentMentioned: (event) => {
      for (const handle of event.handles) {
        intentAPI.launchCommentAgent(
          intentId,
          event.commentBody,
          event.quote,
          event.anchor,
          handle,
          event.threadIndex,
        );
      }
    },
  });
}

async function saveCanvas(): Promise<void> {
  await saveCanvasEditor();
}

async function closeCanvas(): Promise<void> {
  // If previewing, use the saved original content instead of the preview editor content
  const wasPreviewActive = previewActive;
  const savedContent = previewSavedContent;
  if (previewActive) {
    previewActive = false;
    previewSha = null;
    previewSavedContent = null;
    canvasPreviewBanner.classList.add('hidden');
  }
  closeHistoryPanel();
  closeAgentsPanel();
  const intentId = canvasIntentId;
  const wasNewIntent = canvasIsNewIntent;
  const skillId = canvasSkillId;
  canvasIntentId = null;
  canvasSkillId = null;
  canvasIsNewIntent = false;
  canvasClosing = true;

  // Get content BEFORE unmounting — use saved content if we were previewing
  const finalContent = wasPreviewActive ? (savedContent || '') : getCanvasContent();
  await unmountCanvas();

  if (skillId) {
    // Save skill content
    await saveSkillFromCanvas(skillId, finalContent);
  } else if (intentId) {
    await intentAPI.closeCanvas(intentId, finalContent);

    // If this was a new intent created from Enter on empty input,
    // trigger AI refinement using the canvas content as the body
    if (wasNewIntent && finalContent.trim()) {
      await intentAPI.update(intentId, { body: finalContent.trim() });
      processingIntents.add(intentId);
    } else if (wasNewIntent && !finalContent.trim()) {
      // Empty canvas — delete the blank intent
      await intentAPI.delete(intentId);
    }
  }

  canvasDirty = false;

  // Canvas always runs in the popout window now — close it.
  // Keep canvasClosing=true so beforeunload doesn't double-save.
  window.close();
}

// Guard against double-save in beforeunload
let canvasClosing = false;

canvasSaveBtn.addEventListener('click', saveCanvas);
canvasBack.addEventListener('click', closeCanvas);

canvasLaunchBtn.addEventListener('click', async () => {
  if (canvasSkillId) {
    // Skill mode: create intent from skill + launch session
    await launchSkillAsIntent(canvasSkillId);
  } else if (canvasIntentId) {
    // Save any pending edits before launching
    await saveCanvasEditor();

    // Launch SDK agent with full document context and open chat
    const result = await intentAPI.launchDocumentAgent(canvasIntentId);
    if ('error' in result) {
      showStatus(result.error || 'Launch failed', true);
      setTimeout(hideStatus, 3000);
      return;
    }
    // Close the canvas view and open the chat
    closeCanvas();
    openAgentChat(result.agentId, 'Executing document...', 'running', 'sdk');
  }
});

// ── Canvas History Panel ────────────────────────────────
let historyPanelOpen = false;

// ── Canvas Preview State ───────────────────────────────
let previewActive = false;
let previewSha: string | null = null;
let previewSavedContent: string | null = null;

function toggleHistoryPanel(): void {
  if (historyPanelOpen) {
    closeHistoryPanel();
  } else {
    openHistoryPanel();
  }
}

async function openHistoryPanel(): Promise<void> {
  if (!canvasIntentId) return;
  closeAgentsPanel();
  canvasHistoryPanel.classList.remove('hidden');
  canvasHistoryBtn.classList.add('active');
  historyPanelOpen = true;
  canvasHistoryList.innerHTML = '<div class="history-loading">Loading history…</div>';

  const result = await intentAPI.canvasHistory(canvasIntentId);
  if (result.error || result.commits.length === 0) {
    canvasHistoryList.innerHTML = '<div class="history-empty">No history available</div>';
    return;
  }

  canvasHistoryList.innerHTML = '';
  for (const commit of result.commits) {
    canvasHistoryList.appendChild(createHistoryItem(commit));
  }
}

function closeHistoryPanel(): void {
  canvasHistoryPanel.classList.add('hidden');
  canvasHistoryBtn.classList.remove('active');
  historyPanelOpen = false;
  if (previewActive) {
    exitPreview();
  }
}

function createHistoryItem(commit: FolderCommit): HTMLElement {
  const item = document.createElement('div');
  item.className = 'history-item';
  item.dataset.sha = commit.sha;

  const meta = document.createElement('div');
  meta.className = 'history-item-meta';
  meta.textContent = commit.relativeDate;

  const msg = document.createElement('div');
  msg.className = 'history-item-message';
  msg.textContent = commit.message;

  const files = document.createElement('div');
  files.className = 'history-item-files';
  const fileNames = commit.filesChanged.map(f => {
    const parts = f.split('/');
    return parts[parts.length - 1];
  });
  if (fileNames.length > 0) {
    files.textContent = fileNames.join(', ');
  }

  const actions = document.createElement('div');
  actions.className = 'history-item-actions';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'history-view-btn';
  viewBtn.textContent = 'View';
  viewBtn.title = `Preview version ${commit.shortSha}`;
  viewBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await enterPreview(commit);
  });

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'history-restore-btn';
  restoreBtn.textContent = 'Restore';
  restoreBtn.title = `Restore to ${commit.shortSha}`;
  restoreBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!canvasIntentId) return;

    restoreBtn.disabled = true;
    restoreBtn.textContent = '…';

    const result = await intentAPI.canvasRestore(canvasIntentId, commit.sha);
    if (result.success) {
      // Exit preview mode if active (content is now the restored version)
      if (previewActive) {
        previewActive = false;
        previewSha = null;
        previewSavedContent = null;
        canvasPreviewBanner.classList.add('hidden');
      }
      // Reload the canvas with restored content — re-mount in place
      const readResult = await intentAPI.readCanvas(canvasIntentId!);
      if (!readResult.error) {
        const intentId = canvasIntentId!;
        await unmountCanvas();
        canvasIntentId = null;
        await openCanvas(intentId);
      }
      closeHistoryPanel();
    } else {
      restoreBtn.textContent = 'Failed';
      setTimeout(() => {
        restoreBtn.textContent = 'Restore';
        restoreBtn.disabled = false;
      }, 2000);
    }
  });

  actions.appendChild(viewBtn);
  actions.appendChild(restoreBtn);

  item.appendChild(meta);
  item.appendChild(msg);
  if (fileNames.length > 0) item.appendChild(files);
  item.appendChild(actions);

  // Clicking the item itself also triggers preview
  item.addEventListener('click', () => enterPreview(commit));

  return item;
}

async function enterPreview(commit: FolderCommit): Promise<void> {
  if (!canvasIntentId) return;

  // Save current content before first preview
  if (!previewActive) {
    previewSavedContent = getCanvasContent();
  }

  previewSha = commit.sha;
  previewActive = true;

  // Update banner
  canvasPreviewLabel.textContent = `Viewing version from ${commit.relativeDate}`;
  canvasPreviewBanner.classList.remove('hidden');

  // Highlight the previewed item in the history list
  canvasHistoryList.querySelectorAll('.history-item').forEach(el => {
    el.classList.toggle('previewing', (el as HTMLElement).dataset.sha === commit.sha);
  });

  // Fetch version content and mount read-only
  const result = await intentAPI.canvasPreviewVersion(canvasIntentId, commit.sha);
  if (result.error) return;

  const intentId = canvasIntentId!;
  await unmountCanvas();
  const currentTheme = await intentAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark');
  mountCanvas(canvasRoot, {
    intentId,
    content: result.content,
    theme: currentTheme,
    onDirtyChange: () => {},   // no-op: preview edits are not tracked
    onSaveStatus: () => {},    // no-op: preview edits are not saved
  });
}

async function exitPreview(): Promise<void> {
  if (!previewActive || !canvasIntentId) return;

  const savedContent = previewSavedContent;
  previewActive = false;
  previewSha = null;
  previewSavedContent = null;
  canvasPreviewBanner.classList.add('hidden');

  // Remove highlight from history items
  canvasHistoryList.querySelectorAll('.history-item.previewing').forEach(el => {
    el.classList.remove('previewing');
  });

  // Remount with the original content
  const intentId = canvasIntentId!;
  await unmountCanvas();
  const currentTheme = await intentAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark');
  const canvasPersonas = await intentAPI.listPersonas().then(p => p || []);
  mountCanvas(canvasRoot, {
    intentId,
    content: savedContent || '',
    theme: currentTheme,
    personas: canvasPersonas,
    onDirtyChange: (dirty: boolean) => {
      canvasDirty = dirty;
      canvasSaveBtn.classList.toggle('hidden', !dirty);
    },
    onSaveStatus: (status: string) => {
      canvasSaveStatus.textContent = status;
    },
    onAgentMentioned: (event) => {
      for (const handle of event.handles) {
        intentAPI.launchCommentAgent(
          intentId,
          event.commentBody,
          event.quote,
          event.anchor,
          handle,
          event.threadIndex,
        );
      }
    },
  });
}

async function restoreFromPreview(): Promise<void> {
  if (!previewActive || !previewSha || !canvasIntentId) return;

  const sha = previewSha;
  canvasPreviewRestore.disabled = true;
  canvasPreviewRestore.textContent = '…';

  const result = await intentAPI.canvasRestore(canvasIntentId, sha);
  if (result.success) {
    previewActive = false;
    previewSha = null;
    previewSavedContent = null;
    canvasPreviewBanner.classList.add('hidden');

    const readResult = await intentAPI.readCanvas(canvasIntentId!);
    if (!readResult.error) {
      const intentId = canvasIntentId!;
      await unmountCanvas();
      canvasIntentId = null;
      await openCanvas(intentId);
    }
    closeHistoryPanel();
  } else {
    canvasPreviewRestore.textContent = 'Failed';
    setTimeout(() => {
      canvasPreviewRestore.textContent = 'Restore this version';
      canvasPreviewRestore.disabled = false;
    }, 2000);
  }
}

canvasPreviewBack.addEventListener('click', exitPreview);
canvasPreviewRestore.addEventListener('click', restoreFromPreview);

canvasHistoryBtn.addEventListener('click', toggleHistoryPanel);
canvasHistoryClose.addEventListener('click', closeHistoryPanel);

// Refresh history panel when a new auto-commit happens
intentAPI.onWorkspaceCommitted(() => {
  if (historyPanelOpen && canvasIntentId) {
    openHistoryPanel();
  }
});

// ── Canvas Agents Panel ─────────────────────────────────
let agentsPanelOpen = false;

function toggleAgentsPanel(): void {
  if (agentsPanelOpen) {
    closeAgentsPanel();
  } else {
    openAgentsPanel();
  }
}

async function openAgentsPanel(): Promise<void> {
  if (!canvasIntentId) return;
  closeHistoryPanel();
  canvasAgentsPanel.classList.remove('hidden');
  canvasAgentsBtn.classList.add('active');
  agentsPanelOpen = true;
  canvasAgentsList.innerHTML = '<div class="history-loading">Loading sessions…</div>';

  let agents: Array<{ agentId: string; sessionId: string; status: string; summary: string; selectedText: string; createdAt?: string }> = [];
  try {
    agents = await intentAPI.listAgents(canvasIntentId);
  } catch { /* skip */ }

  if (agents.length === 0) {
    canvasAgentsList.innerHTML = '<div class="history-empty">No agent sessions for this space</div>';
    return;
  }

  agents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  canvasAgentsList.innerHTML = agents.map(agent => {
    const statusIcon = agent.status === 'running' ? '⚡' :
                       agent.status === 'waiting-approval' ? '⏳' :
                       agent.status === 'completed' ? '✓' : '✗';
    const statusClass = agent.status === 'running' ? 'agent-running' :
                        agent.status === 'waiting-approval' ? 'agent-waiting' :
                        agent.status === 'completed' ? 'agent-completed' : 'agent-failed';
    const preview = agent.selectedText.length > 60
      ? agent.selectedText.slice(0, 57) + '...'
      : agent.selectedText;
    const ago = agent.createdAt ? timeAgo(agent.createdAt) : '';

    return `
      <div class="canvas-agent-item ${statusClass}" data-agent-id="${agent.agentId}">
        <div class="canvas-agent-status">${statusIcon}</div>
        <div class="canvas-agent-body">
          <div class="canvas-agent-text">${escapeHtml(preview || agent.summary || 'Agent session')}</div>
          <div class="canvas-agent-meta">
            <span>${escapeHtml(agent.status)}</span>
            ${ago ? `<span>${ago}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  canvasAgentsList.querySelectorAll('.canvas-agent-item[data-agent-id]').forEach(el => {
    el.addEventListener('click', () => {
      const agentId = (el as HTMLElement).dataset.agentId;
      if (!agentId) return;
      const agent = agents.find(a => a.agentId === agentId);
      if (agent) {
        openAgentChat(agentId, agent.selectedText, agent.status);
      }
    });
  });
}

function closeAgentsPanel(): void {
  canvasAgentsPanel.classList.add('hidden');
  canvasAgentsBtn.classList.remove('active');
  agentsPanelOpen = false;
}

canvasAgentsBtn.addEventListener('click', toggleAgentsPanel);
canvasAgentsClose.addEventListener('click', closeAgentsPanel);

function updateModeToggleUI(mode: string): void {
  modeToggleRendered.classList.toggle('active', mode === 'rendered');
  modeToggleRaw.classList.toggle('active', mode === 'raw');
}

modeToggleRendered.addEventListener('click', () => {
  if (getCanvasEditorMode() === 'rendered') return;
  const result = toggleCanvasMode();
  updateModeToggleUI(result.mode);
});

modeToggleRaw.addEventListener('click', () => {
  if (getCanvasEditorMode() === 'raw') return;
  const result = toggleCanvasMode();
  updateModeToggleUI(result.mode);
});

(window as any).openCanvas = openCanvas;

// ── Agent Chat View ────────────────────────────────────
import { mountChat, unmountChat } from './chat/mount.tsx';

const chatView = document.getElementById('chat-view') as HTMLDivElement;
const chatRoot = document.getElementById('chat-root') as HTMLDivElement;

async function openAgentChat(agentId: string | undefined, agentPrompt: string, agentStatus: string, agentSource?: 'sdk' | 'cli'): Promise<void> {
  // Hide other views, show chat inline
  mainView.classList.add('hidden');
  hideSettings();
  timelineView.classList.add('hidden');
  canvasView.classList.add('hidden');
  chatView.classList.remove('hidden');

  // Look up pending approval info if agent is waiting
  const approval = agentId ? agentApprovals.get(agentId) : undefined;

  mountChat(chatRoot, {
    agentId,
    agentPrompt,
    agentStatus,
    agentSource,
    pendingApprovalId: approval?.requestId,
    pendingPermissionKind: approval?.permissionKind,
    onClose: () => closeAgentChat(),
    onOpenCli: (id: string) => intentAPI.openAgentCli(id),
  });
}

function closeAgentChat(): void {
  unmountChat();

  chatView.classList.add('hidden');
  mainView.classList.remove('hidden');
  descInput.focus();
  // Refresh the agents list in case a new agent was created
  if (currentFilter === 'agents') renderAgentsList();
}

(window as any).openAgentChat = openAgentChat;

// ── Agent Presence Management ──────────────────────────
const canvasAgentPresence = new Map<string, DocumentPresence>();

function syncCanvasPresence(): void {
  updateCanvasPresence(Array.from(canvasAgentPresence.values()));
}

intentAPI.onAgentPresenceStarted((data) => {
  if (data.intentId !== canvasIntentId) return;
  canvasAgentPresence.set(data.agentId, {
    userId: data.persona.handle,
    color: data.persona.color,
    cursor: data.anchor?.prefix || data.anchor?.suffix ? data.anchor : undefined,
  });
  syncCanvasPresence();
});

intentAPI.onAgentPresenceEnded((data) => {
  if (!canvasAgentPresence.has(data.agentId)) return;
  canvasAgentPresence.delete(data.agentId);
  syncCanvasPresence();
});

intentAPI.onAgentReplyReady((data) => {
  if (data.intentId !== canvasIntentId) return;
  addCanvasCommentReply(data.threadIndex, data.body);
});

intentAPI.onCanvasContentUpdated((data) => {
  if (data.intentId !== canvasIntentId) return;
  replaceCanvasContent(data.content);
});

// ── Global agent status/approval listeners ─────────────
intentAPI.onAgentStatusChanged((data: any) => {
  if (currentFilter === 'agents') renderAgentsList();
  // Refresh Spaces view to update agent indicators
  if (currentFilter === 'open') loadIntents();
  // Clear steps if agent restarted
  if (data.status === 'running' && !agentSteps.has(data.agentId)) {
    agentSteps.set(data.agentId, []);
  }
  // Clear approval and badge when agent is no longer waiting
  if (data.status !== 'waiting-approval') {
    agentApprovals.delete(data.agentId);
    updateWorkersBadge();
  }
});

intentAPI.onAgentApprovalNeeded((data: any) => {
  agentApprovals.set(data.agentId, {
    requestId: data.requestId,
    permissionKind: data.permissionKind || 'permission',
    intention: data.intention,
    path: data.path,
  });
  if (currentFilter === 'agents') {
    updateAgentCardApproval(data.agentId);
  }
  updateWorkersBadge();
});

intentAPI.onAgentCompleted(() => {
  if (currentFilter === 'agents') renderAgentsList();
  if (currentFilter === 'open') loadIntents();
});

// When the user clicks an OS notification, switch to Workers tab
intentAPI.onNotificationApprovalClicked(() => {
  setFilter('agents');
});

// ── Init ────────────────────────────────────────────────
descInput.focus();
loadSettings();
loadFocusState();
loadPinState();

// Flush canvas saves when the window is about to close (app quit, reload)
window.addEventListener('beforeunload', () => {
  if (canvasClosing) return;
  const content = getCanvasContent();
  if (canvasSkillId) {
    saveSkillFromCanvas(canvasSkillId, content);
  } else if (canvasIntentId) {
    intentAPI.closeCanvas(canvasIntentId, content);
  }
});

document.addEventListener('keydown', (e) => {
  // When settings modal is open, only Escape is handled
  if (settingsModalOpen) {
    if (e.key === 'Escape') {
      if (isSettingsMode) {
        window.close();
      } else {
        hideSettings();
      }
    }
    return;
  }

  // Arrow/Enter navigation in the intent list
  if (!mainView.classList.contains('hidden')) {
    // Agent list navigation
    if (currentFilter === 'agents') {
      const agentItems = listEl.querySelectorAll('.agent-card');
      if (e.key === 'ArrowDown' && selectedIndex >= 0) {
        e.preventDefault();
        if (selectedIndex < agentItems.length - 1) {
          selectedIndex++;
          updateAgentSelection();
        }
        return;
      }
      if (e.key === 'ArrowUp' && selectedIndex >= 0) {
        e.preventDefault();
        if (selectedIndex === 0) {
          selectedIndex = -1;
          updateAgentSelection();
          newAgentBtn.classList.contains('hidden') ? descInput.focus() : newAgentBtn.focus();
        } else {
          selectedIndex--;
          updateAgentSelection();
        }
        return;
      }
      if (e.key === 'Enter' && selectedIndex >= 0 && document.activeElement !== newAgentBtn) {
        e.preventDefault();
        const agent = renderedAgents[selectedIndex];
        if (agent) {
          openAgentChat(agent.agentId, agent.selectedText, agent.status, agent.source);
        }
        return;
      }
    } else {
      // Intent list navigation
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
      // Cmd+Enter: open small canvas (summary view) for selected intent
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const target = selectedIndex >= 0
          ? displayedIntents[selectedIndex]
          : displayedIntents[0];
        if (target) openCanvas(target.id);
        return;
      }
      // Enter: open full editor for selected intent
      if (e.key === 'Enter' && selectedIndex >= 0 && document.activeElement !== descInput) {
        e.preventDefault();
        const intent = displayedIntents[selectedIndex];
        if (intent) openCanvas(intent.id, true);
        return;
      }
    }
  }

  if (e.key === 'Escape') {
    if (isRecording) stopRecording();
    if (!chatView.classList.contains('hidden')) {
      closeAgentChat();
      return;
    }
    if (!canvasView.classList.contains('hidden')) {
      closeCanvas();
      return;
    }
    if (!timelineView.classList.contains('hidden')) {
      hideTimeline();
      return;
    }
    slideOut();
  }
});

intentAPI.onWindowShown((data) => {
  selectedIndex = -1;
  searchResults = null;
  if (searchMode) exitSearchMode();
  // Always land on Spaces tab with focus in capture field
  setFilter('open');
  descInput.focus();
  descInput.select();
  hideStatus();
  // Refresh active session state when window reappears
  loadIntents();

  // Slide in from the appropriate edge
  if (!data.expanded) {
    slideIn(data.side);
  } else {
    // Expanded mode: no slide, just make visible immediately
    appEl.classList.remove('app-hidden-left', 'app-hidden-right', 'app-no-transition');
    windowVisualState = 'visible';
  }
});

intentAPI.onWindowToggle(() => {
  // If on a sub-view, navigate back to the intent list
  if (!chatView.classList.contains('hidden')) {
    closeAgentChat();
    return;
  }
  if (!canvasView.classList.contains('hidden')) {
    closeCanvas();
    return;
  }
  if (settingsModalOpen) {
    hideSettings();
    return;
  }
  if (!timelineView.classList.contains('hidden')) {
    hideTimeline();
    return;
  }
  // Already on the main view — animate out then hide
  slideOut();
});

intentAPI.onRequestHide(() => {
  // Blur-triggered hide: check if we should stay visible
  const hasInput = descInput && descInput.value.trim().length > 0;
  const canvasOpen = !canvasView.classList.contains('hidden');
  const chatOpen = !chatView.classList.contains('hidden');
  if (hasInput || canvasOpen || chatOpen) return;

  slideOut();
});

// ── Welcome / Onboarding ────────────────────────────────
let welcomeWorkspaceSelected = false;

function updateWelcomeStartBtn(): void {
  welcomeStartBtn.disabled = !welcomeWorkspaceSelected;
}

async function showWelcomeView(): Promise<void> {
  mainView.classList.add('hidden');
  welcomeView.classList.remove('hidden');
  welcomeWorkspaceSelected = false;

  // Reset step states
  welcomeWorkspaceHint.textContent = 'A folder where your intents, skills, and agent data will live.';
  welcomeWorkspaceBtn.textContent = 'Choose Folder…';
  welcomeWorkspaceCheck.classList.add('hidden');
  welcomeStepWorkspace.classList.remove('done');
  welcomeCliCheck.classList.add('hidden');
  welcomeStepCli.classList.remove('done');
  welcomeCliStatus.textContent = 'Checking…';
  welcomeCliStatus.style.color = '';
  welcomeModelCheck.classList.add('hidden');
  welcomeStepModel.classList.remove('done');
  welcomeModelSelect.innerHTML = '<option value="">Loading models…</option>';
  updateWelcomeStartBtn();

  // Load saved CLI path override into input
  const savedCliPath = await intentAPI.getSetting('cli_path');
  welcomeCliPath.value = savedCliPath || '';

  // Auto-detect CLI and check version compatibility
  checkWelcomeCli();

  // Load models (retry since SDK may still be starting)
  async function loadWelcomeModels(retries = 5): Promise<void> {
    const models = await intentAPI.listModels();
    if (models.length === 0 && retries > 0) {
      welcomeModelSelect.innerHTML = '<option value="">Loading models…</option>';
      setTimeout(() => loadWelcomeModels(retries - 1), 2000);
      return;
    }
    welcomeModelSelect.innerHTML = '';
    if (models.length === 0) {
      welcomeModelSelect.innerHTML = '<option value="">No models available</option>';
      return;
    }
    const saved = await intentAPI.getSetting('model');
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      welcomeModelSelect.appendChild(opt);
    }
    if (saved && models.some(m => m.id === saved)) {
      welcomeModelSelect.value = saved;
    } else {
      welcomeModelSelect.value = models[0].id;
    }
    welcomeModelCheck.classList.remove('hidden');
    welcomeStepModel.classList.add('done');
  }
  loadWelcomeModels();
}

function hideWelcomeView(): void {
  welcomeView.classList.add('hidden');
  mainView.classList.remove('hidden');
  descInput.focus();
}

async function checkWelcomeCli(): Promise<void> {
  welcomeCliStatus.textContent = 'Checking…';
  welcomeCliStatus.style.color = '';
  welcomeCliCheck.classList.add('hidden');
  welcomeStepCli.classList.remove('done');

  const info: { path: string | null; version: string | null; compatible: boolean; minVersion: string } =
    await intentAPI.checkCliVersion();

  if (!info.path) {
    welcomeCliStatus.textContent = 'Not found — install the Copilot CLI or provide a path below.';
  } else if (!info.compatible) {
    const ver = info.version || 'unknown';
    welcomeCliStatus.textContent = `Version ${ver} found — update to ${info.minVersion}+ required (run: copilot update)`;
    welcomeCliStatus.style.color = 'var(--color-warning, #d29922)';
  } else {
    const short = info.path.length > 40 ? '…' + info.path.slice(-38) : info.path;
    welcomeCliStatus.textContent = `Detected: ${short} (v${info.version})`;
    welcomeCliCheck.classList.remove('hidden');
    welcomeStepCli.classList.add('done');
  }
}

// Save CLI path override from welcome screen input
let welcomeCliDebounce: ReturnType<typeof setTimeout> | null = null;
welcomeCliPath.addEventListener('input', () => {
  if (welcomeCliDebounce) clearTimeout(welcomeCliDebounce);
  welcomeCliDebounce = setTimeout(async () => {
    const val = welcomeCliPath.value.trim();
    await intentAPI.setSetting('cli_path', val);
    await checkWelcomeCli();
  }, 500);
});

// Refresh button re-checks CLI after user upgrades
welcomeCliRefresh.addEventListener('click', async () => {
  // Invalidate cache by re-saving the current path (triggers invalidateCliPath on backend)
  const val = welcomeCliPath.value.trim();
  await intentAPI.setSetting('cli_path', val);
  await checkWelcomeCli();
});

welcomeWorkspaceBtn.addEventListener('click', async () => {
  const result = await intentAPI.selectWorkspace();
  if (result.selected && result.path) {
    welcomeWorkspaceSelected = true;
    welcomeWorkspaceHint.textContent = result.path;
    welcomeWorkspaceHint.title = result.path;
    welcomeWorkspaceBtn.textContent = 'Change…';
    welcomeWorkspaceCheck.classList.remove('hidden');
    welcomeStepWorkspace.classList.add('done');
    updateWelcomeStartBtn();
  }
});

welcomeModelSelect.addEventListener('change', () => {
  const model = welcomeModelSelect.value;
  if (model) {
    welcomeModelCheck.classList.remove('hidden');
    welcomeStepModel.classList.add('done');
  } else {
    welcomeModelCheck.classList.add('hidden');
    welcomeStepModel.classList.remove('done');
  }
});

welcomeStartBtn.addEventListener('click', async () => {
  if (!welcomeWorkspaceSelected) return;

  // Save model selection
  const model = welcomeModelSelect.value;
  if (model) {
    await intentAPI.setSetting('model', model);
  }

  hideWelcomeView();
  loadIntents();
  loadSkills();
});

// ── Init ────────────────────────────────────────────────
// Check if workspace is set — show welcome or main view
intentAPI.getSetting('workspace_root').then(ws => {
  if (!ws && !isCanvasMode && !isSettingsMode) {
    showWelcomeView();
  } else if (!isSettingsMode) {
    loadIntents();
  }
});

// Refresh the intent list when the canvas popout window is closed
intentAPI.onCanvasWindowClosed(() => {
  if (!isCanvasMode) loadIntents();
});

// Reload all data when workspace changes (select or clear)
intentAPI.onWorkspaceChanged((path: string | null) => {
  if (isCanvasMode || isSettingsMode) {
    // In canvas/settings window, close it — the workspace changed underneath
    window.close();
    return;
  }
  updateWorkspaceDisplay(path);
  hideSettings();
  if (path) {
    loadIntents();
    loadSkills();
  } else {
    // Workspace cleared — show welcome view
    intents = [];
    cachedSkills = [];
    render();
    showWelcomeView();
  }
});

// ── Canvas popout window mode ───────────────────────────
if (isCanvasMode) {
  // Hide everything except canvas view
  mainView.classList.add('hidden');
  canvasView.classList.remove('hidden');
  document.body.classList.add('canvas-window');

  // Apply theme
  intentAPI.getSetting('theme').then(t => {
    if (t === 'dark') document.body.classList.add('dark');
  });

  // Listen for theme changes from main window
  intentAPI.onCanvasThemeChanged((theme: string) => {
    document.body.classList.toggle('dark', theme === 'dark');
  });

  // Save and unmount the current canvas target (intent or skill)
  async function saveAndUnmountCurrent(): Promise<void> {
    const finalContent = getCanvasContent();
    await unmountCanvas();
    if (canvasSkillId) {
      await saveSkillFromCanvas(canvasSkillId, finalContent);
      canvasSkillId = null;
    } else if (canvasIntentId) {
      await intentAPI.closeCanvas(canvasIntentId, finalContent);
      canvasIntentId = null;
    }
    canvasAgentPresence.clear();
  }

  // Listen for target to load (from main process)
  intentAPI.onLoadCanvasTarget(async (target: { kind: string; id: string; title: string }) => {
    // If a canvas is already open, save and close it first
    if (canvasIntentId || canvasSkillId) {
      await saveAndUnmountCurrent();
    }

    if (target.kind === 'skill') {
      // Load skills list so openSkillEditor can find the skill
      cachedSkills = await intentAPI.listSkills();
      await openSkillEditor(target.id);
    } else {
      // Populate intent data so openCanvas() can find it
      if (!intents.find(i => i.id === target.id)) {
        intents.push({
          id: target.id,
          description: target.title,
          body: null, raw_text: null, client: null,
          due_at: null, due_at_utc: null, recurrence: null,
          completed_at: null, folder: null, session_id: null,
          attachments: [],
          status: 'captured',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        const existing = intents.find(i => i.id === target.id)!;
        existing.description = target.title;
      }

      await openCanvas(target.id);
    }
  });

  // Also load full intents and skills in background for metadata
  intentAPI.list().then(list => { intents = list; });
  intentAPI.listSkills().then(list => { cachedSkills = list; });
}

// ── Settings popout window mode ─────────────────────────
if (isSettingsMode) {
  // Hide everything except settings overlay
  mainView.classList.add('hidden');
  document.body.classList.add('settings-window');

  // Show the settings content as full page (not overlay)
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.classList.add('settings-fullpage');
  settingsModalOpen = true;

  // Apply theme
  intentAPI.getSetting('theme').then(t => {
    if (t === 'dark') document.body.classList.add('dark');
  });

  // Listen for theme changes from main window
  intentAPI.onCanvasThemeChanged((theme: string) => {
    document.body.classList.toggle('dark', theme === 'dark');
  });

  // Load settings data
  loadModels();
  loadWorkspaceSetting();
  loadThemeSetting();
  loadPersonas();
  loadCliPathSetting();
  loadMcpServers();
  loadCliTools();

  // Close button closes the window
  settingsClose.addEventListener('click', () => window.close());
}
