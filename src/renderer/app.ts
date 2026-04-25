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
  readCanvas(intentId: string): Promise<{ content: string; error?: string }>;
  writeCanvas(intentId: string, content: string): Promise<{ success?: boolean; error?: string }>;
  closeCanvas(intentId: string, content: string): Promise<void>;
  canvasHistory(intentId: string): Promise<{ commits: FolderCommit[]; error?: string }>;
  canvasRestore(intentId: string, sha: string): Promise<{ success: boolean; error?: string }>;
  searchIntents(query: string): Promise<Intent[]>;
  summarizeTitle(canvasContent: string): Promise<{ title: string | null }>;
  pasteFile(intentId: string, filename: string, dataArray: number[]): Promise<{ success?: boolean; relativePath?: string; filename?: string; error?: string }>;
  listAgents(intentId: string): Promise<any[]>;
  quickLaunchAgent(prompt: string): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  listAllAgents(): Promise<any[]>;
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
  onWindowShown(callback: () => void): void;
  onWindowToggle(callback: () => void): void;
  onWorkspaceCommitted(callback: () => void): void;
  onIntentProcessed(callback: (id: string) => void): void;
  onRecurrenceResult(callback: (intentId: string, result: RecurrenceResult) => void): void;
  onRecurrenceApplied(callback: (intentId: string) => void): void;
  onRecallHint(callback: (intentId: string, match: RecallMatch) => void): void;
  onAgentStatusChanged(callback: (data: any) => void): void;
  onAgentApprovalNeeded(callback: (data: any) => void): void;
  onAgentCompleted(callback: (data: any) => void): void;
  onAgentPresenceStarted(callback: (data: { agentId: string; intentId: string; persona: { name: string; handle: string; color?: string; imageUrl?: string }; anchor: { prefix?: string; suffix?: string } }) => void): void;
  onAgentPresenceEnded(callback: (data: { agentId: string; intentId: string }) => void): void;
  onAgentReplyReady(callback: (data: { agentId: string; intentId: string; threadIndex: number; body: string }) => void): void;
  openPath(folderPath: string): Promise<void>;
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
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement;
const settingsBackdrop = settingsOverlay.querySelector('.settings-backdrop') as HTMLDivElement;
const settingsClose = document.getElementById('settings-close') as HTMLButtonElement;
const mainView = document.getElementById('main-view') as HTMLDivElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const recordingIndicator = document.getElementById('recording-indicator') as HTMLDivElement;
const themeLightBtn = document.getElementById('theme-light') as HTMLButtonElement;
const themeDarkBtn = document.getElementById('theme-dark') as HTMLButtonElement;
const timelineBtn = document.getElementById('timeline-btn') as HTMLButtonElement | null;
const timelineView = document.getElementById('timeline-view') as HTMLDivElement;
const timelineBack = document.getElementById('timeline-back') as HTMLButtonElement;
const timelineContent = document.getElementById('timeline-content') as HTMLDivElement;
const pinBtn = document.getElementById('pin-btn') as HTMLButtonElement;

let intents: Intent[] = [];
// Track intents being processed by LLM
const processingIntents = new Set<string>();
// Track intents with active running terminal sessions
let activeSessionIntents = new Set<string>();
// Current filter
let currentFilter: 'open' | 'agents' | 'closed' = 'open';
const filterOrder: Array<'open' | 'agents' | 'closed'> = ['open', 'agents', 'closed'];
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
function setFilter(filter: typeof currentFilter): void {
  if (filter === currentFilter) return;
  currentFilter = filter;
  filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = filterBar.querySelector(`[data-filter="${filter}"]`) as HTMLElement;
  if (btn) btn.classList.add('active');

  // Toggle capture form vs new-agent button vs past
  if (filter === 'agents') {
    form.style.display = 'none';
    newAgentBtn.classList.remove('hidden');
    launchCliBtn.classList.remove('hidden');
    agentSummaryEl.classList.remove('hidden');
  } else if (filter === 'closed') {
    form.style.display = 'none';
    newAgentBtn.classList.add('hidden');
    launchCliBtn.classList.add('hidden');
    agentSummaryEl.classList.add('hidden');
  } else {
    form.style.display = '';
    newAgentBtn.classList.add('hidden');
    launchCliBtn.classList.add('hidden');
    agentSummaryEl.classList.add('hidden');
  }

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
    if (currentFilter === 'agents') {
      newAgentBtn.focus();
    } else {
      descInput.focus();
    }
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
  settingsOverlay.classList.remove('hidden');
  settingsModalOpen = true;
  settingsBtn.classList.add('active');
  loadModels();
  loadWorkspaceSetting();
  loadThemeSetting();
  loadPersonas();
  loadCliPathSetting();
  loadMcpServers();
  loadCliTools();
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
});

themeDarkBtn.addEventListener('click', async () => {
  await intentAPI.setSetting('theme', 'dark');
  applyTheme('dark');
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
  personasList.innerHTML = '';
  for (const persona of personas) {
    personasList.appendChild(createPersonaCard(persona));
  }
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
  meta.textContent = modelName ? (modelName.name || modelName.id) : (persona.model || 'Default model');
  if (persona.model && !modelName) {
    meta.classList.add('unavailable');
    meta.textContent = persona.model + ' (unavailable)';
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
        ? { ...p, handle: rawHandle, instructions, model }
        : p
      );
    } else {
      // Add new
      personas.push({
        id: crypto.randomUUID(),
        handle: rawHandle,
        instructions,
        model,
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

  // Up arrow: go to filter bar (tabs are above the prompt now)
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    focusActiveFilter();
    return;
  }

  // Down arrow: go to intent list
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    if (currentFilter !== 'agents' && displayedIntents.length > 0) {
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
  // If input is empty, create a blank intent and open it in the full editor
  if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    const text = descInput.value.trim();
    if (!text) {
      createAndOpenCanvas();
    } else {
      form.requestSubmit();
    }
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
  } else if (currentFilter === 'agents') {
    // Agents mode — render agent list instead of intents
    renderAgentsList();
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

    return `
    <div class="intent-item ${intent.status === 'done' ? 'done' : ''} ${isProcessing ? 'processing' : ''} ${isFocused ? 'focused' : ''}" data-id="${intent.id}" onclick="openCanvas('${intent.id}', true)">
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
const agentApprovals = new Map<string, { requestId: string; permissionKind: string }>();
const agentChatUnsubs = new Map<string, () => void>();

function humanizeToolName(toolName: string): string {
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
        label: humanizeToolName(event.toolName || 'Working'),
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
      agentApprovals.set(agentId, { requestId: event.requestId, permissionKind: event.permissionKind });
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
  approvalEl.innerHTML = `
    <span class="approval-label">⏳ Approval needed: ${escapeHtml(approval.permissionKind)}</span>
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

async function renderAgentsList(): Promise<void> {
  const gen = ++renderGeneration;
  displayedIntents = [];
  countEl.textContent = String(intents.filter(i => i.status !== 'done').length);

  // Gather all agents (including workspace-level ones)
  let allAgents: Array<{ agentId: string; sessionId: string; status: string; summary: string; selectedText: string; intentId: string; createdAt?: string; pendingApprovalId?: string | null; pendingPermissionKind?: string | null; source?: 'sdk' | 'cli' }> = [];

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

  // Store for keyboard nav
  renderedAgents = allAgents;
  selectedIndex = -1;

  // Render the summary card
  renderAgentSummary(allAgents);

  if (allAgents.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="icon">⚡</span>
        <span>No agents running.</span>
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
      : agent.status === 'running' ? '⚡' :
                       agent.status === 'waiting-approval' ? '⏳' :
                       agent.status === 'completed' ? '✓' : '✗';

    const intentLabel = agent.source === 'cli'
      ? 'CLI Session'
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
      const icon = step.status === 'done' ? '<span class="step-icon step-done">✓</span>' :
                   step.status === 'failed' ? '<span class="step-icon step-failed">✗</span>' :
                   '<span class="step-icon step-running"></span>';
      const connector = i < visible.length - 1 ? '<div class="step-connector"></div>' : '';
      return `<div class="step-item">${icon}<span class="step-label">${escapeHtml(step.label)}</span></div>${connector}`;
    }).join('') : (agent.status === 'running' ? `<div class="step-item"><span class="step-icon step-running"></span><span class="step-label">${escapeHtml(agent.summary)}</span></div>` : '');

    // Build approval HTML
    const approval = agentApprovals.get(agent.agentId);
    const approvalHtml = approval ? `
      <div class="agent-card-approval">
        <span class="approval-label">⏳ Approval needed: ${escapeHtml(approval.permissionKind)}</span>
        <div class="approval-actions">
          <button class="approval-btn approve" data-agent-id="${agent.agentId}" data-request-id="${approval.requestId}">Approve</button>
          <button class="approval-btn deny" data-agent-id="${agent.agentId}" data-request-id="${approval.requestId}">Deny</button>
        </div>
      </div>
    ` : '';

    return `
      <div class="agent-card ${statusClass}" data-agent-id="${agent.agentId}" title="Click to open chat">
        <div class="agent-card-header">
          <span class="agent-card-icon">${statusIcon}</span>
          <span class="agent-card-name">${intentLabel}</span>
        </div>
        <div class="agent-card-title">${escapeHtml(title)}</div>
        ${stepsHtml ? `<div class="agent-card-steps">${stepsHtml}</div>` : ''}
        ${agent.status === 'completed' || agent.status === 'failed' ? `<div class="agent-card-summary">${escapeHtml(agent.summary)}</div>` : ''}
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
    workspacePathEl.classList.add('clickable');
  } else {
    workspacePathEl.textContent = 'Not set';
    workspacePathEl.title = '';
    workspacePathEl.classList.remove('clickable');
  }
}

workspaceBtn.addEventListener('click', async () => {
  const result = await intentAPI.selectWorkspace();
  if (result.selected) {
    updateWorkspaceDisplay(result.path);
  }
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
  const detected = await intentAPI.resolveCliPath();

  cliPathInput.value = override || '';
  cliPathClear.classList.toggle('hidden', !override);
  cliPathDetected.textContent = detected || 'Not found';
  cliPathDetected.title = detected || '';
}

let cliPathDebounce: ReturnType<typeof setTimeout> | null = null;
cliPathInput.addEventListener('input', () => {
  if (cliPathDebounce) clearTimeout(cliPathDebounce);
  cliPathDebounce = setTimeout(async () => {
    const val = cliPathInput.value.trim();
    await intentAPI.setSetting('cli_path', val);
    cliPathClear.classList.toggle('hidden', !val);
    const detected = await intentAPI.resolveCliPath();
    cliPathDetected.textContent = detected || 'Not found';
    cliPathDetected.title = detected || '';
  }, 500);
});

cliPathClear.addEventListener('click', async () => {
  cliPathInput.value = '';
  await intentAPI.setSetting('cli_path', '');
  cliPathClear.classList.add('hidden');
  const detected = await intentAPI.resolveCliPath();
  cliPathDetected.textContent = detected || 'Not found';
  cliPathDetected.title = detected || '';
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
  await intentAPI.delete(id);
  await loadIntents();
}

(window as any).toggleStatus = toggleStatus;
(window as any).deleteIntent = deleteIntent;

// ── Canvas view ─────────────────────────────────────────
import { mountCanvas, unmountCanvas, getCanvasContent, saveCanvas as saveCanvasEditor, updateCanvasPresence, addCanvasCommentReply } from './canvas/mount.tsx';
import type { Presence } from 'documint';

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
const canvasAgentsBtn = document.getElementById('canvas-agents-btn') as HTMLButtonElement;
const canvasAgentsPanel = document.getElementById('canvas-agents-panel') as HTMLDivElement;
const canvasAgentsClose = document.getElementById('canvas-agents-close') as HTMLButtonElement;
const canvasAgentsList = document.getElementById('canvas-agents-list') as HTMLDivElement;
let canvasIntentId: string | null = null;
let canvasDirty = false;
let canvasExpanded = false;
let canvasIsNewIntent = false;
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

  canvasIntentId = intentId;
  canvasTitle.textContent = intent.description;
  canvasTitle.contentEditable = 'false';
  canvasTitle.classList.remove('editing');
  canvasTitleAI.classList.add('hidden');
  canvasSaveStatus.textContent = '';
  canvasDirty = false;
  canvasSaveBtn.classList.add('hidden');

  // Expand window if requested
  canvasExpanded = expanded;
  if (expanded) {
    intentAPI.expandWindow();
  }

  // Show canvas view immediately while data loads
  mainView.classList.add('hidden');
  hideSettings();
  timelineView.classList.add('hidden');
  canvasView.classList.remove('hidden');

  // Load all data in parallel
  const [result, currentTheme, canvasPersonas] = await Promise.all([
    intentAPI.readCanvas(intentId),
    intentAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark'),
    intentAPI.listPersonas().then(p => p || []),
  ]);

  if (result.error === 'no_workspace') {
    // Revert view back to main
    canvasView.classList.add('hidden');
    mainView.classList.remove('hidden');
    showStatus('Select a workspace first');
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
      // Launch an agent for each @mentioned persona
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
  closeHistoryPanel();
  closeAgentsPanel();
  const intentId = canvasIntentId;
  const wasNewIntent = canvasIsNewIntent;
  canvasIntentId = null;
  canvasIsNewIntent = false;

  // Get content BEFORE unmounting (unmount destroys the React ref)
  const finalContent = getCanvasContent();
  await unmountCanvas();

  if (intentId) {
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

  // Collapse window if it was expanded
  if (canvasExpanded) {
    canvasExpanded = false;
    intentAPI.collapseWindow();
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

// ── Canvas History Panel ────────────────────────────────
let historyPanelOpen = false;

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
}

function createHistoryItem(commit: FolderCommit): HTMLElement {
  const item = document.createElement('div');
  item.className = 'history-item';

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
      // Reload the canvas with restored content
      const readResult = await intentAPI.readCanvas(canvasIntentId!);
      if (!readResult.error) {
        // Re-open the canvas to refresh the editor
        const intentId = canvasIntentId!;
        const expanded = canvasExpanded;
        await closeCanvas();
        await openCanvas(intentId, expanded);
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

  actions.appendChild(restoreBtn);

  item.appendChild(meta);
  item.appendChild(msg);
  if (fileNames.length > 0) item.appendChild(files);
  item.appendChild(actions);

  return item;
}

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

  mountChat(chatRoot, {
    agentId,
    agentPrompt,
    agentStatus,
    agentSource,
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
const canvasAgentPresence = new Map<string, Presence>();

function syncCanvasPresence(): void {
  updateCanvasPresence(Array.from(canvasAgentPresence.values()));
}

intentAPI.onAgentPresenceStarted((data) => {
  if (data.intentId !== canvasIntentId) return;
  canvasAgentPresence.set(data.agentId, {
    name: data.persona.name,
    color: data.persona.color,
    imageUrl: data.persona.imageUrl,
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

// ── Global agent status/approval listeners ─────────────
intentAPI.onAgentStatusChanged((data: any) => {
  if (currentFilter === 'agents') renderAgentsList();
  // Clear steps if agent restarted
  if (data.status === 'running' && !agentSteps.has(data.agentId)) {
    agentSteps.set(data.agentId, []);
  }
});

intentAPI.onAgentApprovalNeeded((data: any) => {
  agentApprovals.set(data.agentId, {
    requestId: data.requestId,
    permissionKind: data.permissionKind || 'permission',
  });
  if (currentFilter === 'agents') {
    updateAgentCardApproval(data.agentId);
  }
});

intentAPI.onAgentCompleted(() => {
  if (currentFilter === 'agents') renderAgentsList();
});

// ── Init ────────────────────────────────────────────────
descInput.focus();
loadSettings();
loadFocusState();
loadPinState();

// Flush canvas saves when the window is about to close (app quit, reload)
window.addEventListener('beforeunload', () => {
  if (canvasIntentId) {
    const content = getCanvasContent();
    intentAPI.closeCanvas(canvasIntentId, content);
  }
});

document.addEventListener('keydown', (e) => {
  // When settings modal is open, only Escape is handled
  if (settingsModalOpen) {
    if (e.key === 'Escape') {
      hideSettings();
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
          newAgentBtn.focus();
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
  // Already on the main view — hide the window
  intentAPI.hideWindow();
});

loadIntents();
