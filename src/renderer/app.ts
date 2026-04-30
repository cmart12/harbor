/**
 * MIGRATION NOTE: This file is being incrementally migrated to React components.
 * See src/renderer/MIGRATION.md for the migration plan.
 * New features should use:
 *   - src/renderer/ipc-client.ts (typed IPC)
 *   - src/renderer/state/ (space-store, agent-store)
 *   - src/renderer/views/ (React components)
 */

interface RecurrenceResult {
  should_recur: boolean;
  reasoning: string;
  next_due: string | null;
  next_due_utc: string | null;
}

interface RecallMatch {
  space_id: string;
  description: string;
  completed_at: string | null;
  confidence: number;
}

interface SandboxPolicy {
  scopeToSpaceFolder: boolean;
  extraReadwritePaths: string[];
  extraReadonlyPaths: string[];
  extraDeniedPaths: string[];
  allowMcpServers: boolean;
  allowWebFetch: boolean;
  allowOutbound: boolean;
  allowLocalNetwork: boolean;
  enforcementMode: 'both' | 'mxc-only';
}

const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  scopeToSpaceFolder: true,
  extraReadwritePaths: [],
  extraReadonlyPaths: [],
  extraDeniedPaths: [],
  allowMcpServers: false,
  allowWebFetch: false,
  allowOutbound: false,
  allowLocalNetwork: false,
  enforcementMode: 'both',
};

interface AgentPersona {
  id: string;
  handle: string;
  instructions: string;
  model: string;
  runLocation: 'local' | 'cloud';
  sandboxed?: boolean;
  emoji?: string;
  cliRuntime?: string;
  sandboxPolicyOverride?: SandboxPolicy;
}

interface CliRuntime {
  id: string;
  label: string;
  path: string;
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

interface WhimAPI {
  create(input: { body: string }): Promise<Space>;
  list(): Promise<Space[]>;
  update(id: string, updates: Record<string, unknown>): Promise<Space>;
  delete(id: string): Promise<boolean>;
  dismissRecurrence(id: string): Promise<boolean>;
  transcribe(audioData: number[]): Promise<string>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<string | null | undefined>;
  resolveCliPath(): Promise<string | null>;
  checkCliVersion(): Promise<{ path: string | null; version: string | null; compatible: boolean; minVersion: string }>;
  checkCliMxcCapable(): Promise<{ mxcCapable: boolean }>;
  listModels(): Promise<{ id: string; name?: string }[]>;
  listPersonas(): Promise<AgentPersona[]>;
  savePersonas(personas: AgentPersona[]): Promise<{ ok?: boolean; error?: string }>;
  listRuntimes(): Promise<CliRuntime[]>;
  saveRuntimes(runtimes: CliRuntime[]): Promise<{ ok?: boolean; error?: string; runtimes?: CliRuntime[] }>;
  listDiscoveredMcp(): Promise<DiscoveredMcpServer[]>;
  listCustomMcp(): Promise<CustomMcpServer[]>;
  saveCustomMcp(servers: CustomMcpServer[]): Promise<{ ok?: boolean; error?: string }>;
  listCliTools(): Promise<CliToolDefinition[]>;
  saveCliTools(tools: CliToolDefinition[]): Promise<{ ok?: boolean; error?: string }>;
  getSandboxDefaultPolicy(): Promise<SandboxPolicy>;
  saveSandboxDefaultPolicy(policy: SandboxPolicy): Promise<{ ok?: boolean; policy?: SandboxPolicy; error?: string }>;
  openSandboxConfigPreview(policy: SandboxPolicy): Promise<{ ok?: boolean; path?: string; error?: string }>;
  resolveSandboxBlock(agentId: string, requestId: string, decision: 'allow-once' | 'allow-for-session' | 'disable'): Promise<{ ok?: boolean; error?: string }>;
  listEvents(limit?: number): Promise<any[]>;
  resolveDate(dateText: string): Promise<{ due_at: string; due_at_utc: string | null }>;
  classifyInput(text: string): Promise<{ type: 'space' | 'query'; query_answer?: string }>;
  launchSession(spaceId: string): Promise<{ success: boolean; error?: string; sessionId?: string }>;
  getActiveSessions(): Promise<string[]>;
  selectWorkspace(): Promise<{ selected: boolean; path: string | null }>;
  clearWorkspace(): Promise<{ ok: boolean }>;
  onWorkspaceChanged(callback: (path: string | null) => void): void;
  readCanvas(spaceId: string): Promise<{ content: string; error?: string }>;
  writeCanvas(spaceId: string, content: string): Promise<{ success?: boolean; error?: string }>;
  closeCanvas(spaceId: string, content: string): Promise<void>;
  canvasHistory(spaceId: string): Promise<{ commits: FolderCommit[]; error?: string }>;
  canvasRestore(spaceId: string, sha: string): Promise<{ success: boolean; error?: string }>;
  canvasPreviewVersion(spaceId: string, sha: string): Promise<{ content: string; error?: string }>;
  searchSpaces(query: string): Promise<Space[]>;
  unarchive(id: string): Promise<Space | null>;
  summarizeTitle(canvasContent: string): Promise<{ title: string | null }>;
  pasteFile(spaceId: string, filename: string, dataArray: number[]): Promise<{ success?: boolean; relativePath?: string; filename?: string; error?: string }>;
  openSpaceFolder(spaceId: string): Promise<void>;
  listAgents(spaceId: string): Promise<any[]>;
  quickLaunchAgent(prompt: string, personaHandle?: string): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  listAllAgents(): Promise<any[]>;
  deleteAgentSession(agentId: string): Promise<{ ok?: boolean; error?: string }>;
  setAgentYolo(agentId: string, enabled: boolean): Promise<{ ok?: boolean; error?: string }>;
  launchCloudAgent(spaceId: string, prompt: string): Promise<{ agentId?: string; sessionId?: string; jobId?: string; error?: string }>;
  getCloudJobStatus(agentId: string): Promise<any>;
  launchCliSession(): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  getAgentHistory(agentId: string): Promise<{ events?: any[]; error?: string }>;
  openAgentCli(agentId: string): Promise<{ error?: string }>;
  onChatEvent(agentId: string, callback: (event: any) => void): () => void;
  launchAgent(spaceId: string, selectedText: string, anchor: any, options?: { repo?: string; model?: string }): Promise<any>;
  launchCommentAgent(spaceId: string, commentBody: string, quotedText: string, anchor: any, personaHandle: string, threadIndex: number): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<void>;
  abortAgent(agentId: string): Promise<void>;
  hideWindow(): void;
  expandWindow(): void;
  collapseWindow(): void;
  getPinned(): Promise<boolean>;
  setPinned(pinned: boolean): void;
  onPinnedChanged(callback: (pinned: boolean) => void): void;
  openCanvasWindow(target: { kind: string; id: string; title: string }): void;
  openNewCanvasWindow(target: { kind: string; id: string; title: string }): void;
  onLoadCanvasTarget(callback: (target: { kind: string; id: string; title: string }) => void): void;
  onCanvasWindowClosed(callback: () => void): void;
  notifyCanvasThemeChanged(theme: string): void;
  onCanvasThemeChanged(callback: (theme: string) => void): void;
  openAgentChatInPanel(data: { agentId: string; agentPrompt: string; agentStatus: string; agentSource?: 'sdk' | 'cli'; spaceId?: string }): void;
  onOpenAgentChatInPanel(callback: (data: { agentId: string; agentPrompt: string; agentStatus: string; agentSource?: 'sdk' | 'cli'; spaceId?: string }) => void): void;
  openSettingsWindow(): void;
  onWindowShown(callback: (data: { side: 'left' | 'right'; expanded: boolean }) => void): void;
  onWindowToggle(callback: () => void): void;
  onRequestHide(callback: () => void): void;
  onWorkspaceCommitted(callback: () => void): void;
  onSpaceProcessed(callback: (id: string) => void): void;
  onRecurrenceResult(callback: (spaceId: string, result: RecurrenceResult) => void): void;
  onRecurrenceApplied(callback: (spaceId: string) => void): void;
  onRecallHint(callback: (spaceId: string, match: RecallMatch) => void): void;
  onAgentStatusChanged(callback: (data: any) => void): void;
  onAgentApprovalNeeded(callback: (data: any) => void): void;
  onAgentSandboxBlocked(callback: (data: {
    agentId: string;
    requestId: string;
    source: 'permission' | 'pre-tool' | 'post-tool-shell';
    kind: 'read' | 'write' | 'shell' | 'mcp' | 'url' | 'web-fetch';
    toolName?: string;
    target: string;
    intention?: string;
    allowedDecisions?: Array<'allow-once' | 'allow-for-session' | 'disable'>;
    layer?: 'host:readonly-classifier' | 'host:path-policy' | 'host:web-fetch' | 'host:permission' | 'mxc:shell-denial-suspected';
  }) => void): void;
  onAgentCompleted(callback: (data: any) => void): void;
  onAgentYoloChanged(callback: (data: { agentId: string; enabled: boolean }) => void): void;
  onNotificationApprovalClicked(callback: (data: { agentId: string }) => void): void;
  onAgentPresenceStarted(callback: (data: { agentId: string; spaceId: string; persona: { name: string; handle: string; color?: string; imageUrl?: string }; anchor: { prefix?: string; suffix?: string } }) => void): void;
  onAgentPresenceEnded(callback: (data: { agentId: string; spaceId: string }) => void): void;
  onAgentReplyReady(callback: (data: { agentId: string; spaceId: string; threadIndex: number; body: string }) => void): void;
  onCanvasContentUpdated(callback: (data: { spaceId: string; content: string }) => void): () => void;
  openPath(folderPath: string): Promise<void>;
  // ── Skills ──────────────────────────────────────────────
  listSkills(): Promise<any[]>;
  readSkill(skillId: string): Promise<{ frontmatter: Record<string, unknown>; body: string } | { error: string }>;
  writeSkill(skillId: string, frontmatter: Record<string, unknown>, body: string): Promise<{ success: boolean } | { error: string }>;
  createSkill(name: string): Promise<any>;
  createSkillFromPrompt(description: string): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  deleteSkill(skillId: string): Promise<boolean>;
  openSkillFolder(skillId: string): Promise<void>;
  createSpaceFromSkill(skillId: string): Promise<any>;
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

interface Space {
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

declare const whimAPI: WhimAPI;

// ── Canvas window mode detection ────────────────────────
const isCanvasMode = new URLSearchParams(window.location.search).get('mode') === 'canvas';
const isSettingsMode = new URLSearchParams(window.location.search).get('mode') === 'settings';

const descInput = document.getElementById('description-input') as HTMLTextAreaElement;
const form = document.getElementById('capture-form') as HTMLFormElement;
const listEl = document.getElementById('space-list') as HTMLDivElement;
const countEl = document.getElementById('space-count') as HTMLSpanElement;
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

let spaces: Space[] = [];
// Track spaces being processed by LLM
const processingSpaces = new Set<string>();
// Track spaces with active running terminal sessions
let activeSessionSpaces = new Set<string>();
// Track agents per space for Spaces view
let agentsBySpace = new Map<string, Array<{ agentId: string; status: string; summary: string; selectedText: string; source?: string }>>();
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
let focusedSpaceId: string | null = null;
let selectedIndex = -1;
let displayedSpaces: Space[] = [];
let searchResults: Space[] | null = null;
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
    whimAPI.hideWindow();
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
    whimAPI.hideWindow();
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
    case 'agents': return 'What should an agent work on? (start with @ to pick a persona)';
    case 'skills': return 'Describe a skill to create...';
    default: return 'What needs to get done?';
  }
}

function getSearchPlaceholderForFilter(filter: typeof currentFilter): string {
  switch (filter) {
    case 'agents': return '🔍 Search agents...';
    case 'skills': return '🔍 Search skills...';
    default: return '🔍 Search spaces...';
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

  // Show capture form on Spaces, Workers, and Skills; hide on History
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

  // Close persona @-mention dropdown if open and clear any selection state.
  hideMentionDropdown();
  selectedPersonaHandle = null;

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
  const result = await whimAPI.launchCliSession();
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
  whimAPI.openSettingsWindow();
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
  whimAPI.setPinned(next);
  pinBtn.classList.toggle('active', next);
  pinBtn.title = next ? 'Unpin window' : 'Pin window (keep visible)';
});

whimAPI.onPinnedChanged((pinned: boolean) => {
  pinBtn.classList.toggle('active', pinned);
  pinBtn.title = pinned ? 'Unpin window' : 'Pin window (keep visible)';
});

async function loadPinState(): Promise<void> {
  const pinned = await whimAPI.getPinned();
  pinBtn.classList.toggle('active', pinned);
  pinBtn.title = pinned ? 'Unpin window' : 'Pin window (keep visible)';
}

modelSelect.addEventListener('change', async () => {
  const model = modelSelect.value;
  if (model) {
    await whimAPI.setSetting('model', model);
    showStatus(`✓ Model set to ${model}`);
    setTimeout(hideStatus, 2000);
  }
});

async function loadModels(): Promise<void> {
  const currentModel = await whimAPI.getSetting('model');
  try {
    const models = await whimAPI.listModels();
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
  const theme = await whimAPI.getSetting('theme');
  applyTheme(theme || 'light');
}

// ── Theme ───────────────────────────────────────────────
function applyTheme(theme: string): void {
  document.body.classList.toggle('dark', theme === 'dark');
  themeLightBtn.classList.toggle('active', theme !== 'dark');
  themeDarkBtn.classList.toggle('active', theme === 'dark');
}

async function loadThemeSetting(): Promise<void> {
  const theme = await whimAPI.getSetting('theme');
  applyTheme(theme || 'light');
}

themeLightBtn.addEventListener('click', async () => {
  await whimAPI.setSetting('theme', 'light');
  applyTheme('light');
  whimAPI.notifyCanvasThemeChanged('light');
});

themeDarkBtn.addEventListener('click', async () => {
  await whimAPI.setSetting('theme', 'dark');
  applyTheme('dark');
  whimAPI.notifyCanvasThemeChanged('dark');
});

async function loadWorkspaceSetting(): Promise<void> {
  const ws = await whimAPI.getSetting('workspace_root');
  updateWorkspaceDisplay(ws);
}

// ── Agent Personas ──────────────────────────────────────
const agentsSelectionList = document.getElementById('agents-selection-list') as HTMLDivElement;
const agentsEditor = document.getElementById('agents-editor') as HTMLDivElement;
const personaAddBtn = document.getElementById('persona-add-btn') as HTMLButtonElement;
let personas: AgentPersona[] = [];
let personaModels: { id: string; name?: string }[] = [];
let selectedAgentId: string | null = null;

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DEFAULT_AGENT_HANDLE = 'agent';
const DEFAULT_AGENT_INSTRUCTIONS = 'Follow the users instructions and respond to comments or create comments when you work on canvas.md documents.';

function ensureDefaultAgent(): void {
  const hasDefault = personas.some(p => p.handle === DEFAULT_AGENT_HANDLE);
  if (!hasDefault) {
    personas.unshift({
      id: 'default-agent',
      handle: DEFAULT_AGENT_HANDLE,
      instructions: DEFAULT_AGENT_INSTRUCTIONS,
      model: '',
      runLocation: 'local',
    });
    // Persist immediately so backend knows about it
    whimAPI.savePersonas(personas);
  }
}

async function loadPersonas(): Promise<void> {
  personas = await whimAPI.listPersonas() || [];
  try { personaModels = await whimAPI.listModels(); } catch { personaModels = []; }
  ensureDefaultAgent();
  renderAgentsSidebar();
  // Auto-select @agent if nothing selected
  if (!selectedAgentId) {
    const defaultAgent = personas.find(p => p.handle === DEFAULT_AGENT_HANDLE);
    if (defaultAgent) selectAgent(defaultAgent.id);
  } else {
    // Re-render editor for currently selected agent
    const current = personas.find(p => p.id === selectedAgentId);
    if (current) renderAgentEditor(current);
    else {
      selectedAgentId = null;
      renderAgentEditorPlaceholder();
    }
  }
}

function renderAgentsSidebar(): void {
  agentsSelectionList.innerHTML = '';
  // Sort: @agent always first, then alphabetical
  const sorted = [...personas].sort((a, b) => {
    if (a.handle === DEFAULT_AGENT_HANDLE) return -1;
    if (b.handle === DEFAULT_AGENT_HANDLE) return 1;
    return a.handle.localeCompare(b.handle);
  });
  for (const persona of sorted) {
    const item = document.createElement('div');
    item.className = 'agent-list-item' + (persona.id === selectedAgentId ? ' active' : '');
    item.dataset.agentId = persona.id;

    const emoji = document.createElement('span');
    emoji.className = 'agent-list-emoji';
    emoji.textContent = persona.emoji || '🤖';

    const handle = document.createElement('span');
    handle.className = 'agent-list-handle';
    handle.textContent = '@' + persona.handle;

    item.appendChild(emoji);
    item.appendChild(handle);
    item.addEventListener('click', () => selectAgent(persona.id));
    agentsSelectionList.appendChild(item);
  }
}

function selectAgent(agentId: string): void {
  selectedAgentId = agentId;
  // Update active state in list
  agentsSelectionList.querySelectorAll('.agent-list-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.agentId === agentId);
  });
  const persona = personas.find(p => p.id === agentId);
  if (persona) renderAgentEditor(persona);
}

function renderAgentEditorPlaceholder(): void {
  agentsEditor.innerHTML = '<div class="agents-editor-placeholder">Select an agent to edit its settings.</div>';
}

function renderAgentEditor(persona: AgentPersona): void {
  agentsEditor.innerHTML = '';
  const isDefault = persona.handle === DEFAULT_AGENT_HANDLE;

  const form = document.createElement('div');
  form.className = 'persona-form';
  form.style.border = 'none';
  form.style.padding = '0';
  form.style.background = 'none';

  // Handle input — with emoji picker
  const handleRow = document.createElement('div');
  handleRow.className = 'persona-form-row';
  const emojiBtn = document.createElement('button');
  emojiBtn.type = 'button';
  emojiBtn.className = 'emoji-picker-btn';
  emojiBtn.textContent = persona.emoji || '🤖';
  emojiBtn.title = 'Pick emoji avatar';
  let selectedEmoji = persona.emoji || '';

  const EMOJI_OPTIONS = [
    '😀','😎','🤖','👻','🦊','🐱','🐶','🦁',
    '🧠','💡','🔥','⚡','🚀','🎯','💻','🛡️',
    '🌟','🎨','🔮','🧪','🪄','👾','🤠','🥷',
    '🦄','🐙','🦅','🐝','🌈','❄️','🌊','🍀',
  ];

  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing_popup = document.querySelector('.emoji-picker-popup');
    if (existing_popup) { existing_popup.remove(); return; }

    const popup = document.createElement('div');
    popup.className = 'emoji-picker-popup';
    for (const em of EMOJI_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = em;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectedEmoji = em;
        emojiBtn.textContent = em;
        popup.remove();
      });
      popup.appendChild(btn);
    }

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Clear emoji';
    clearBtn.style.color = '#999';
    clearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectedEmoji = '';
      emojiBtn.textContent = '🤖';
      popup.remove();
    });
    popup.appendChild(clearBtn);

    emojiBtn.style.position = 'relative';
    emojiBtn.appendChild(popup);

    const closePopup = () => { popup.remove(); document.removeEventListener('click', closePopup); };
    setTimeout(() => document.addEventListener('click', closePopup), 0);
  });

  const handleLabel = document.createElement('label');
  handleLabel.textContent = '@';
  handleLabel.className = 'persona-handle-prefix';
  const handleInput = document.createElement('input');
  handleInput.type = 'text';
  handleInput.className = 'persona-form-input';
  handleInput.placeholder = 'handle';
  handleInput.value = persona.handle;
  handleInput.maxLength = 32;
  if (isDefault) {
    handleInput.readOnly = true;
    handleInput.style.opacity = '0.6';
    handleInput.title = 'The default agent handle cannot be changed';
  }
  handleRow.appendChild(emojiBtn);
  handleRow.appendChild(handleLabel);
  handleRow.appendChild(handleInput);

  // Instructions textarea
  const instrRow = document.createElement('div');
  instrRow.className = 'persona-form-row';
  const instrInput = document.createElement('textarea');
  instrInput.className = 'persona-form-textarea';
  instrInput.placeholder = 'Instructions for this agent...';
  instrInput.value = persona.instructions;
  instrInput.rows = 4;
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
    if (m.id === persona.model) opt.selected = true;
    modelSelect.appendChild(opt);
  }

  modelRow.appendChild(modelLabel);
  modelRow.appendChild(modelSelect);

  // Run location dropdown
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
  if (persona.runLocation === 'cloud') cloudOpt.selected = true;
  locationRow.appendChild(locationLabel);
  locationRow.appendChild(locationSelect);

  // Sandbox checkbox (visible on all platforms, functional on Windows only)
  const isWindows = whimAPI.getPlatform() === 'win32';
  const sandboxRow = document.createElement('div');
  sandboxRow.className = 'persona-form-row persona-sandbox-row';
  if (persona.runLocation === 'cloud') {
    sandboxRow.style.display = 'none';
  }
  const sandboxLabel = document.createElement('label');
  sandboxLabel.className = 'persona-form-checkbox-label';
  const sandboxCheck = document.createElement('input');
  sandboxCheck.type = 'checkbox';
  sandboxCheck.checked = persona.sandboxed === true;
  if (!isWindows) {
    sandboxCheck.disabled = true;
    sandboxCheck.checked = false;
  }
  sandboxLabel.appendChild(sandboxCheck);
  sandboxLabel.appendChild(document.createTextNode(' 🔒 Run in sandbox (restrict writes & dangerous commands)'));
  if (!isWindows) {
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);margin-left:4px';
    hint.textContent = '(Windows only)';
    sandboxLabel.appendChild(hint);
    sandboxLabel.style.opacity = '0.55';
    sandboxLabel.title = 'Sandbox requires Windows + the mxc-aware Copilot CLI build';
  }
  sandboxRow.appendChild(sandboxLabel);

  locationSelect.addEventListener('change', () => {
    if (locationSelect.value === 'cloud') {
      sandboxRow.style.display = 'none';
      sandboxCheck.checked = false;
      sandboxOverrideRow.style.display = 'none';
    } else {
      sandboxRow.style.display = '';
      if (isWindows) updateSandboxOverrideVisibility();
    }
  });

  // Sandbox override
  const sandboxOverrideRow = document.createElement('div');
  sandboxOverrideRow.className = 'persona-form-row persona-sandbox-override-row';
  sandboxOverrideRow.style.display = 'none';
  sandboxOverrideRow.style.flexDirection = 'column';
  sandboxOverrideRow.style.gap = '6px';

  const inheritLabel = document.createElement('label');
  inheritLabel.className = 'persona-form-checkbox-label';
  const inheritCheck = document.createElement('input');
  inheritCheck.type = 'checkbox';
  // For @agent, there's no "inherit" — it IS the default
  if (isDefault) {
    inheritCheck.checked = false;
    inheritLabel.style.display = 'none';
  } else {
    inheritCheck.checked = persona.sandboxPolicyOverride == null;
  }
  inheritLabel.appendChild(inheritCheck);
  inheritLabel.appendChild(document.createTextNode(' Inherit sandbox policy from @agent'));
  sandboxOverrideRow.appendChild(inheritLabel);

  const overrideContainer = document.createElement('div');
  overrideContainer.className = 'sandbox-policy-form';
  overrideContainer.style.display = (isDefault || !inheritCheck.checked) ? '' : 'none';
  sandboxOverrideRow.appendChild(overrideContainer);

  let personaPolicyApi: { getPolicy: () => SandboxPolicy; setPolicy: (p: SandboxPolicy) => void } | null = null;

  async function ensurePolicyForm(): Promise<void> {
    if (personaPolicyApi) return;
    let initial: SandboxPolicy;
    if (isDefault) {
      // @agent reads/writes the global default sandbox policy
      try {
        initial = await whimAPI.getSandboxDefaultPolicy() ?? DEFAULT_SANDBOX_POLICY;
      } catch {
        initial = DEFAULT_SANDBOX_POLICY;
      }
    } else if (persona.sandboxPolicyOverride) {
      initial = persona.sandboxPolicyOverride;
    } else {
      try {
        initial = await whimAPI.getSandboxDefaultPolicy() ?? DEFAULT_SANDBOX_POLICY;
      } catch {
        initial = DEFAULT_SANDBOX_POLICY;
      }
    }
    personaPolicyApi = renderSandboxPolicyForm(overrideContainer, initial, { idPrefix: `persona-${persona.id}` });
  }

  inheritCheck.addEventListener('change', async () => {
    if (inheritCheck.checked) {
      overrideContainer.style.display = 'none';
    } else {
      await ensurePolicyForm();
      overrideContainer.style.display = '';
    }
  });

  function updateSandboxOverrideVisibility(): void {
    if (sandboxCheck.checked && isWindows && locationSelect.value !== 'cloud') {
      sandboxOverrideRow.style.display = '';
      if (isDefault || !inheritCheck.checked) ensurePolicyForm();
    } else {
      sandboxOverrideRow.style.display = 'none';
    }
  }
  sandboxCheck.addEventListener('change', updateSandboxOverrideVisibility);
  if (sandboxCheck.checked) updateSandboxOverrideVisibility();

  // CLI Runtime dropdown
  const runtimeRow = document.createElement('div');
  runtimeRow.className = 'persona-form-row';
  const runtimeLabel = document.createElement('label');
  runtimeLabel.textContent = 'CLI Runtime';
  runtimeLabel.className = 'persona-form-label';
  const runtimeSelect = document.createElement('select');
  runtimeSelect.className = 'persona-form-select';
  const defaultRtOpt = document.createElement('option');
  defaultRtOpt.value = '';
  defaultRtOpt.textContent = 'Default';
  runtimeSelect.appendChild(defaultRtOpt);
  whimAPI.listRuntimes().then(runtimes => {
    for (const rt of runtimes) {
      const opt = document.createElement('option');
      opt.value = rt.id;
      opt.textContent = rt.label;
      if (rt.id === persona.cliRuntime) opt.selected = true;
      runtimeSelect.appendChild(opt);
    }
  });
  runtimeRow.appendChild(runtimeLabel);
  runtimeRow.appendChild(runtimeSelect);

  // Error display
  const errorEl = document.createElement('div');
  errorEl.className = 'persona-form-error hidden';

  // Action buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'persona-form-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'persona-form-save';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const rawHandle = isDefault ? DEFAULT_AGENT_HANDLE : handleInput.value.trim().replace(/^@/, '').toLowerCase();
    const instructions = instrInput.value.trim();
    const model = modelSelect.value;
    const runLocation = locationSelect.value as 'local' | 'cloud';
    const sandboxed = sandboxCheck.checked && runLocation === 'local';
    const emoji = selectedEmoji;
    const cliRuntime = runtimeSelect.value;

    // For @agent, save sandbox policy to global default as well
    let sandboxOverride: SandboxPolicy | undefined;
    if (isDefault && sandboxed && personaPolicyApi) {
      const policy = personaPolicyApi.getPolicy();
      await whimAPI.saveSandboxDefaultPolicy(policy);
      sandboxOverride = undefined; // @agent uses the global default
    } else if (sandboxed && !inheritCheck.checked && personaPolicyApi) {
      sandboxOverride = personaPolicyApi.getPolicy();
    }

    if (!isDefault && !HANDLE_RE.test(rawHandle)) {
      errorEl.textContent = 'Handle must be 1-32 lowercase letters, numbers, or dashes.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!instructions) {
      errorEl.textContent = 'Instructions are required.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!isDefault) {
      const duplicate = personas.find(p => p.handle === rawHandle && p.id !== persona.id);
      if (duplicate) {
        errorEl.textContent = `Handle @${rawHandle} is already taken.`;
        errorEl.classList.remove('hidden');
        return;
      }
    }

    personas = personas.map(p => p.id === persona.id
      ? {
          ...p,
          handle: rawHandle,
          instructions,
          model,
          runLocation,
          emoji: emoji || undefined,
          cliRuntime: cliRuntime || undefined,
          ...(sandboxed ? { sandboxed: true } : { sandboxed: undefined }),
          ...(sandboxOverride ? { sandboxPolicyOverride: sandboxOverride } : { sandboxPolicyOverride: undefined }),
        }
      : p
    );

    await whimAPI.savePersonas(personas);
    renderAgentsSidebar();
    // Show brief save confirmation
    errorEl.textContent = 'Saved.';
    errorEl.classList.remove('hidden');
    errorEl.style.color = '#2d8a3a';
    setTimeout(() => { errorEl.classList.add('hidden'); errorEl.style.color = ''; }, 1500);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'persona-form-cancel';
  deleteBtn.textContent = 'Delete';
  deleteBtn.style.color = '#b91414';
  if (isDefault) {
    deleteBtn.style.display = 'none';
  }
  deleteBtn.addEventListener('click', async () => {
    if (isDefault) return;
    personas = personas.filter(p => p.id !== persona.id);
    await whimAPI.savePersonas(personas);
    selectedAgentId = null;
    renderAgentsSidebar();
    // Select @agent after deletion
    const defaultAgent = personas.find(p => p.handle === DEFAULT_AGENT_HANDLE);
    if (defaultAgent) selectAgent(defaultAgent.id);
    else renderAgentEditorPlaceholder();
  });

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(deleteBtn);

  // "Open config preview" — materializes the persona's current sandbox
  // policy to a config.json file under userData/sandbox-config/preview/ and
  // opens it in the OS default text editor. Lets the user verify exactly
  // which config the runtime will load at agent launch (companion to the
  // [sandbox] launch-time logs in main).
  const previewBtn = document.createElement('button');
  previewBtn.className = 'persona-form-cancel';
  previewBtn.type = 'button';
  previewBtn.textContent = 'Open config preview';
  previewBtn.title = 'Materialize the runtime config.json for this policy and open it in your default text editor.';
  previewBtn.style.marginLeft = 'auto';
  previewBtn.addEventListener('click', async () => {
    if (!sandboxCheck.checked) {
      errorEl.textContent = 'Enable "Run in sandbox" to preview the config.';
      errorEl.classList.remove('hidden');
      return;
    }
    // Materialize the policy form lazily — covers both inherit-from-default
    // and explicit-override cases. Either way personaPolicyApi.getPolicy()
    // returns the values that would be saved on click.
    await ensurePolicyForm();
    if (!personaPolicyApi) {
      errorEl.textContent = 'Could not load sandbox policy form.';
      errorEl.classList.remove('hidden');
      return;
    }
    const policy = personaPolicyApi.getPolicy();
    const result = await whimAPI.openSandboxConfigPreview(policy);
    if (result?.ok) {
      errorEl.textContent = `Opened ${result.path}`;
      errorEl.style.color = '#2d8a3a';
      errorEl.classList.remove('hidden');
      setTimeout(() => { errorEl.classList.add('hidden'); errorEl.style.color = ''; }, 2500);
    } else {
      errorEl.textContent = result?.error || 'Failed to open config preview';
      errorEl.classList.remove('hidden');
    }
  });
  // Hide the preview button when sandbox is off (or the platform doesn't
  // support sandboxing at all) — there's nothing meaningful to materialize.
  const updatePreviewVisibility = () => {
    previewBtn.style.display = sandboxCheck.checked && isWindows ? '' : 'none';
  };
  updatePreviewVisibility();
  sandboxCheck.addEventListener('change', updatePreviewVisibility);
  btnRow.appendChild(previewBtn);

  form.appendChild(handleRow);
  form.appendChild(instrRow);
  form.appendChild(modelRow);
  form.appendChild(locationRow);
  form.appendChild(sandboxRow);
  form.appendChild(sandboxOverrideRow);
  form.appendChild(runtimeRow);
  form.appendChild(errorEl);
  form.appendChild(btnRow);

  agentsEditor.appendChild(form);
}

personaAddBtn.addEventListener('click', () => {
  const newId = crypto.randomUUID();
  const newPersona: AgentPersona = {
    id: newId,
    handle: '',
    instructions: '',
    model: '',
    runLocation: 'local',
  };
  personas.push(newPersona);
  renderAgentsSidebar();
  selectAgent(newId);
});

// ── CLI Runtimes ────────────────────────────────────────
const runtimesList = document.getElementById('runtimes-list') as HTMLDivElement;
const runtimeAddBtn = document.getElementById('runtime-add-btn') as HTMLButtonElement;
let cliRuntimes: CliRuntime[] = [];

async function loadRuntimes(): Promise<void> {
  cliRuntimes = await whimAPI.listRuntimes() || [];
  renderRuntimes();
}

function renderRuntimes(): void {
  const openForm = runtimesList.querySelector('.persona-form');
  runtimesList.innerHTML = '';
  for (const rt of cliRuntimes) {
    runtimesList.appendChild(createRuntimeCard(rt));
  }
  if (openForm) runtimesList.appendChild(openForm);
}

function createRuntimeCard(rt: CliRuntime): HTMLElement {
  const card = document.createElement('div');
  card.className = 'persona-card';

  const info = document.createElement('div');
  info.className = 'persona-card-info';

  const label = document.createElement('div');
  label.className = 'persona-card-handle';
  label.textContent = rt.label;

  const pathEl = document.createElement('div');
  pathEl.className = 'persona-card-instructions';
  pathEl.textContent = rt.path;

  info.appendChild(label);
  info.appendChild(pathEl);

  const actions = document.createElement('div');
  actions.className = 'persona-card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'persona-action-btn';
  editBtn.textContent = '✎';
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => showRuntimeForm(rt));

  const delBtn = document.createElement('button');
  delBtn.className = 'persona-action-btn danger';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', async () => {
    cliRuntimes = cliRuntimes.filter(r => r.id !== rt.id);
    await whimAPI.saveRuntimes(cliRuntimes);
    renderRuntimes();
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  card.appendChild(info);
  card.appendChild(actions);
  return card;
}

function showRuntimeForm(existing?: CliRuntime): void {
  const prev = runtimesList.querySelector('.persona-form');
  if (prev) prev.remove();

  const form = document.createElement('div');
  form.className = 'persona-form';

  const labelRow = document.createElement('div');
  labelRow.className = 'persona-form-row';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'persona-form-input';
  labelInput.placeholder = 'Label (e.g. Copilot Dev)';
  labelInput.value = existing?.label || '';
  labelInput.maxLength = 50;
  labelRow.appendChild(labelInput);

  const pathRow = document.createElement('div');
  pathRow.className = 'persona-form-row';
  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.className = 'persona-form-input';
  pathInput.placeholder = 'Path or command (e.g. copilot-dev)';
  pathInput.value = existing?.path || '';
  pathInput.spellcheck = false;
  pathRow.appendChild(pathInput);

  const errorEl = document.createElement('div');
  errorEl.className = 'persona-form-error hidden';

  const btnRow = document.createElement('div');
  btnRow.className = 'persona-form-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'persona-form-save';
  saveBtn.textContent = existing ? 'Save' : 'Add';
  saveBtn.addEventListener('click', async () => {
    const label = labelInput.value.trim();
    const rPath = pathInput.value.trim();
    if (!label) {
      errorEl.textContent = 'Label is required.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!rPath) {
      errorEl.textContent = 'Path is required.';
      errorEl.classList.remove('hidden');
      return;
    }

    if (existing) {
      cliRuntimes = cliRuntimes.map(r => r.id === existing.id ? { ...r, label, path: rPath } : r);
    } else {
      cliRuntimes.push({ id: crypto.randomUUID(), label, path: rPath });
    }

    const result = await whimAPI.saveRuntimes(cliRuntimes);
    // Update local state with resolved paths from the backend
    if (result && result.runtimes) {
      cliRuntimes = result.runtimes;
    }
    form.remove();
    renderRuntimes();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'persona-form-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => form.remove());

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  form.appendChild(labelRow);
  form.appendChild(pathRow);
  form.appendChild(errorEl);
  form.appendChild(btnRow);

  runtimesList.appendChild(form);
  labelInput.focus();
}

runtimeAddBtn.addEventListener('click', () => showRuntimeForm());

// ── MCP Servers ─────────────────────────────────────────
const mcpDiscoveredList = document.getElementById('mcp-discovered-list') as HTMLDivElement;
const mcpCustomList = document.getElementById('mcp-custom-list') as HTMLDivElement;
const mcpAddBtn = document.getElementById('mcp-add-btn') as HTMLButtonElement;
let customMcpServers: CustomMcpServer[] = [];

async function loadMcpServers(): Promise<void> {
  // Load discovered MCPs
  try {
    const discovered: DiscoveredMcpServer[] = await whimAPI.listDiscoveredMcp();
    mcpDiscoveredList.innerHTML = '';
    for (const s of discovered) {
      mcpDiscoveredList.appendChild(createMcpCard(s, true));
    }
  } catch { mcpDiscoveredList.innerHTML = ''; }

  // Load custom MCPs
  try {
    customMcpServers = await whimAPI.listCustomMcp() || [];
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
      await whimAPI.saveCustomMcp(customMcpServers);
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
    await whimAPI.saveCustomMcp(customMcpServers);
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
    cliTools = await whimAPI.listCliTools() || [];
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
    await whimAPI.saveCliTools(cliTools);
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

    await whimAPI.saveCliTools(cliTools);
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
        const text = await whimAPI.transcribe(Array.from(float32));

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

// ── Persona @-mention autocomplete (Workers tab) ─────────
// When the prompt starts with @<token>, show a dropdown of matching personas.
// Tab/Enter selects the highlighted persona; Space/whitespace closes the
// dropdown and the selected handle (if any) is forwarded on submit.
const mentionDropdown = document.getElementById('persona-mention-dropdown') as HTMLDivElement;
let mentionMatches: AgentPersona[] = [];
let mentionSelectedIndex = 0;
// Persona handle the user has explicitly selected (via dropdown or by typing
// a complete valid handle).  Cleared if the user edits the leading mention
// away.  Used at submit time as the source of truth, with raw-text parsing
// as a fallback for hand-typed handles.
let selectedPersonaHandle: string | null = null;
let mentionComposing = false;

descInput.addEventListener('compositionstart', () => { mentionComposing = true; });
descInput.addEventListener('compositionend', () => {
  mentionComposing = false;
  refreshMentionDropdown();
});

function isMentionEnabled(): boolean {
  return currentFilter === 'agents' && !searchMode;
}

/** Parse a leading "@token" from the raw value if present (no whitespace consumed). */
function parseLeadingMentionToken(value: string): { token: string; afterIndex: number } | null {
  if (!value.startsWith('@')) return null;
  // Match leading @<chars-without-whitespace>
  const m = value.match(/^@(\S*)/);
  if (!m) return null;
  return { token: m[1], afterIndex: m[0].length };
}

/** Find the persona whose handle exactly matches the given token (case-insensitive). */
function findExactPersona(token: string): AgentPersona | null {
  const lower = token.toLowerCase();
  return personas.find(p => p.handle.toLowerCase() === lower) || null;
}

function refreshMentionDropdown(): void {
  if (mentionComposing) return;
  if (!isMentionEnabled()) {
    hideMentionDropdown();
    return;
  }

  const value = descInput.value;
  const parsed = parseLeadingMentionToken(value);
  if (!parsed) {
    hideMentionDropdown();
    selectedPersonaHandle = null;
    return;
  }

  // If user has typed past the @token (i.e. value contains whitespace after the token),
  // dropdown is closed.  Persona-handle state is locked-in based on what was selected/typed.
  const afterToken = value.slice(parsed.afterIndex);
  if (/^\s/.test(afterToken)) {
    hideMentionDropdown();
    // Only keep selectedPersonaHandle if the locked-in handle matches the token exactly.
    const exact = findExactPersona(parsed.token);
    selectedPersonaHandle = exact ? exact.handle : null;
    return;
  }

  // Kick off a silent reload so personas saved in the settings popout window
  // become available without restarting the main window.  The current render
  // uses the cached `personas` array; the reload re-runs this function.
  void maybeRefreshPersonas();

  // Filter personas whose handle starts with the typed prefix (case-insensitive).
  // Empty token matches all personas.
  const lower = parsed.token.toLowerCase();
  const matches = personas.filter(p => p.handle.toLowerCase().startsWith(lower));

  // Pre-set selectedPersonaHandle if exact match is typed.
  const exact = findExactPersona(parsed.token);
  selectedPersonaHandle = exact ? exact.handle : null;

  if (matches.length === 0) {
    hideMentionDropdown();
    return;
  }

  mentionMatches = matches;
  // Keep selection within bounds.
  if (mentionSelectedIndex < 0 || mentionSelectedIndex >= matches.length) {
    mentionSelectedIndex = 0;
  }
  renderMentionDropdown();
}

// Throttle background persona reloads so we don't hammer the IPC on every keystroke.
let mentionPersonasReloadAt = 0;
let mentionPersonasReloadInflight = false;
async function maybeRefreshPersonas(): Promise<void> {
  if (mentionPersonasReloadInflight) return;
  const now = Date.now();
  if (now - mentionPersonasReloadAt < 1500) return;
  mentionPersonasReloadAt = now;
  mentionPersonasReloadInflight = true;
  try {
    const fresh = await whimAPI.listPersonas() || [];
    const changed = fresh.length !== personas.length
      || fresh.some((p, i) => p.handle !== personas[i]?.handle);
    if (changed) {
      personas = fresh;
      // Re-render only if the dropdown is open or if the input still starts with @
      if (descInput.value.startsWith('@')) refreshMentionDropdown();
    }
  } catch { /* leave cached personas in place */ }
  finally {
    mentionPersonasReloadInflight = false;
  }
}

function renderMentionDropdown(): void {
  mentionDropdown.innerHTML = '';
  for (let i = 0; i < mentionMatches.length; i++) {
    const p = mentionMatches[i];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mention-item' + (i === mentionSelectedIndex ? ' selected' : '');
    item.setAttribute('role', 'option');
    item.dataset.handle = p.handle;

    const handleEl = document.createElement('span');
    handleEl.className = 'mention-item-handle';
    handleEl.textContent = (p.emoji ? p.emoji + ' ' : '') + '@' + p.handle;
    item.appendChild(handleEl);

    if (p.instructions) {
      const instrEl = document.createElement('span');
      instrEl.className = 'mention-item-instructions';
      const firstLine = p.instructions.split('\n')[0];
      instrEl.textContent = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
      item.appendChild(instrEl);
    }

    item.addEventListener('mousedown', (e) => {
      // mousedown to fire before blur/input loses focus
      e.preventDefault();
      acceptMentionAt(i);
    });
    mentionDropdown.appendChild(item);
  }
  mentionDropdown.classList.remove('hidden');
}

function hideMentionDropdown(): void {
  mentionDropdown.classList.add('hidden');
  mentionMatches = [];
  mentionSelectedIndex = 0;
}

function isMentionDropdownOpen(): boolean {
  return !mentionDropdown.classList.contains('hidden');
}

/** Replace the leading @token with the selected persona handle + trailing space. */
function acceptMentionAt(index: number): void {
  const persona = mentionMatches[index];
  if (!persona) return;
  const value = descInput.value;
  const parsed = parseLeadingMentionToken(value);
  if (!parsed) return;
  const rest = value.slice(parsed.afterIndex);
  const completion = rest.length > 0 && /^\s/.test(rest) ? '' : ' ';
  descInput.value = `@${persona.handle}${completion}${rest}`;
  // Place caret right after the trailing space.
  const caret = ('@' + persona.handle).length + completion.length;
  descInput.setSelectionRange(caret, caret);
  selectedPersonaHandle = persona.handle;
  hideMentionDropdown();
  autoResize();
  inputHints.classList.toggle('hidden', descInput.value.length > 0);
}

// Refresh dropdown on input changes.
descInput.addEventListener('input', refreshMentionDropdown);

// Hide dropdown when filter changes (e.g. user switches tabs).
window.addEventListener('blur', () => hideMentionDropdown());
descInput.addEventListener('blur', () => {
  // Delay so click on dropdown items can register.
  setTimeout(() => hideMentionDropdown(), 100);
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
      searchResults = await whimAPI.searchSpaces(query);
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
//
// Persona @-mention dropdown takes precedence: arrow/enter/tab/escape are
// captured when the dropdown is open so they don't fall through to the
// existing nav/submit/voice logic below.
descInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (!isMentionDropdownOpen()) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopImmediatePropagation();
    mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionMatches.length;
    renderMentionDropdown();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopImmediatePropagation();
    mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionMatches.length) % mentionMatches.length;
    renderMentionDropdown();
    return;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    e.stopImmediatePropagation();
    acceptMentionAt(mentionSelectedIndex);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    hideMentionDropdown();
    return;
  }
  // Space: close dropdown but let the space character through naturally.
  if (e.key === ' ') {
    hideMentionDropdown();
    return;
  }
});

descInput.addEventListener('keydown', (e) => {
  // Shift+Tab: toggle search mode on Spaces, Workers, and Skills tabs
  if (e.key === 'Tab' && e.shiftKey) {
    if (currentFilter === 'closed') return; // no search on History tab
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
    } else if (displayedSpaces.length > 0) {
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
      openAgentChat(renderedAgents[0].agentId, renderedAgents[0].selectedText, renderedAgents[0].status, (renderedAgents[0] as any).source, renderedAgents[0].spaceId);
    } else if (currentFilter === 'skills' && cachedSkills.length > 0) {
      const q = activeSearchQuery.toLowerCase();
      const match = q ? cachedSkills.find(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : cachedSkills[0];
      if (match) openSkillEditor(match.id);
    } else if (displayedSpaces.length > 0) {
      openCanvas(displayedSpaces[0].id);
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

async function animateRefinement(spaceId: string): Promise<void> {
  const oldIntent = spaces.find(i => i.id === spaceId);
  const oldText = oldIntent?.description || '';

  const updatedSpaces = await whimAPI.list();
  const newSpace = updatedSpaces.find(i => i.id === spaceId);

  if (!newSpace || oldText === newSpace.description) {
    spaces = updatedSpaces;
    render();
    return;
  }

  const itemEl = listEl.querySelector(`[data-id="${spaceId}"]`);
  const descEl = itemEl?.querySelector('.whim-desc') as HTMLElement | null;

  if (!descEl) {
    spaces = updatedSpaces;
    render();
    return;
  }

  itemEl?.classList.remove('processing');
  const badge = itemEl?.querySelector('.processing-badge');
  if (badge) badge.remove();

  await animateTextReplace(descEl, oldText, newSpace.description);

  // Fade in new meta
  const metaEl = itemEl?.querySelector('.whim-meta') as HTMLElement | null;
  if (metaEl) {
    const dueInfo = formatDueDate(newSpace.due_at_utc, newSpace.due_at);
    const hasDue = dueInfo.text !== '';
    const isRecurring = !!newSpace.recurrence;
    let metaHtml = '';
    if (newSpace.client) metaHtml += `<span class="meta-fade-in">👤 ${escapeHtml(newSpace.client)}</span>`;
    if (hasDue) metaHtml += `<span class="meta-fade-in due-badge ${dueInfo.overdue ? 'overdue' : ''}">📅 ${escapeHtml(dueInfo.text)}</span>`;
    if (isRecurring) metaHtml += `<span class="meta-fade-in recurring-badge">↻</span>`;
    metaHtml += `<span>${timeAgo(newSpace.updated_at)}</span>`;
    metaEl.innerHTML = metaHtml;
  }

  spaces = updatedSpaces;
}

// ── Space CRUD ─────────────────────────────────────────
async function loadSpaces(): Promise<void> {
  spaces = await whimAPI.list();
  activeSessionSpaces = new Set(await whimAPI.getActiveSessions());

  // Build agents-per-space map for Spaces view
  try {
    const allAgents = await whimAPI.listAllAgents();
    const map = new Map<string, Array<{ agentId: string; status: string; summary: string; selectedText: string; source?: string }>>();
    for (const agent of allAgents) {
      if (!agent.spaceId || agent.spaceId === '__workspace__') continue;
      if (!map.has(agent.spaceId)) map.set(agent.spaceId, []);
      map.get(agent.spaceId)!.push({
        agentId: agent.agentId,
        status: agent.status,
        summary: agent.summary,
        selectedText: agent.selectedText,
        source: agent.source,
      });
    }
    agentsBySpace = map;
  } catch { /* skip */ }

  updateFocusBanner();
  render();
}

function render(): void {
  let displayList: Space[];

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
    // History mode — render card-based combined view
    renderHistoryView();
    return;
  } else {
    // Normal mode — open spaces
    displayList = spaces.filter(i => i.status !== 'done');
  }
  displayedSpaces = displayList;

  countEl.textContent = String(spaces.filter(i => i.status !== 'done').length);

  if (displayList.length === 0) {
    const emptyMsg = searchResults !== null ? 'No matching spaces.' :
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

  listEl.innerHTML = displayList.map(space => {
    const isProcessing = processingSpaces.has(space.id);
    const isRecurring = !!space.recurrence;
    const isRunning = activeSessionSpaces.has(space.id);
    const dueInfo = formatDueDate(space.due_at_utc, space.due_at);
    const hasDue = dueInfo.text !== '';
    const isFocused = space.id === focusedSpaceId;

    // Agent data for this space
    const spaceAgents = agentsBySpace.get(space.id) || [];
    const hasRunningAgents = spaceAgents.some(a => a.status === 'running');
    const hasWaitingAgents = spaceAgents.some(a => a.status === 'waiting-approval');
    const hasFailedAgents = spaceAgents.some(a => a.status === 'failed');

    // Build agent mini-cards
    let agentsHtml = '';
    if (spaceAgents.length > 0) {
      const agentCards = spaceAgents.map(agent => {
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
      agentsHtml = `<div class="space-agents">${agentCards}</div>`;
    }

    return `
    <div class="space-item ${space.status === 'done' ? 'done' : ''} ${isProcessing ? 'processing' : ''} ${isFocused ? 'focused' : ''} ${hasRunningAgents ? 'has-running-agents' : ''} ${hasWaitingAgents ? 'has-waiting-agents' : ''}" data-id="${space.id}" onclick="openCanvas('${space.id}', true)">
      <div class="space-check ${space.status === 'done' ? 'checked' : ''}"
           onclick="event.stopPropagation(); toggleStatus('${space.id}')">${space.status === 'done' ? '✓' : ''}</div>
      <div class="space-content">
        <div class="space-desc ${hasRunningAgents ? 'agent-active' : ''}">${escapeHtml(space.description)}</div>
        <div class="space-meta">
          ${space.client ? `<span>👤 ${escapeHtml(space.client)}</span>` : ''}
          ${hasDue ? `<span class="due-badge ${dueInfo.overdue ? 'overdue' : ''}">📅 ${escapeHtml(dueInfo.text)}</span>` : ''}
          ${isRecurring ? '<span class="recurring-badge">↻</span>' : ''}
          ${isRunning ? '<span class="session-badge running">● running</span>' : space.session_id ? '<span class="session-badge">○ session</span>' : ''}
          ${hasRunningAgents ? `<span class="session-badge running">⚡ ${spaceAgents.filter(a => a.status === 'running').length} working</span>` : ''}
          ${hasWaitingAgents ? '<span class="session-badge agent-attention">⏳ needs attention</span>' : ''}
          ${hasFailedAgents ? '<span class="session-badge agent-failed-badge">✗ failed</span>' : ''}
          ${isProcessing ? '<span class="processing-badge">refining...</span>' : ''}
          <span>${timeAgo(space.updated_at)}</span>
        </div>
        ${agentsHtml}
        <div class="recall-hint hidden" data-recall-for="${space.id}"></div>
      </div>
      ${space.status !== 'done' ? `<button class="space-focus ${isFocused ? 'is-focused' : ''}" onclick="event.stopPropagation(); setFocus('${space.id}')" title="${isFocused ? 'Unfocus' : 'Focus'}">🎯</button>` : ''}
      <button class="space-launch ${space.session_id ? 'has-session' : ''} ${isRunning ? 'is-running' : ''}" onclick="event.stopPropagation(); launchSession('${space.id}')" title="${isRunning ? 'Switch to session' : space.session_id ? 'Resume session' : 'Start session'}">▶</button>
      <button class="space-delete" onclick="event.stopPropagation(); deleteSpace('${space.id}')">✕</button>
    </div>
  `;
  }).join('');

  // Wire mini-agent click handlers to open chat directly
  listEl.querySelectorAll('.mini-agent[data-agent-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const agentId = (el as HTMLElement).dataset.agentId!;
      // Find the agent data
      for (const [spaceId, agents] of agentsBySpace.entries()) {
        const agent = agents.find(a => a.agentId === agentId);
        if (agent) {
          openAgentChat(agentId, agent.selectedText, agent.status, agent.source as any, spaceId);
          return;
        }
      }
    });
  });

  if (selectedIndex >= displayedSpaces.length) {
    selectedIndex = -1;
  }
  updateSelection();
}

async function renderHistoryView(): Promise<void> {
  const gen = ++renderGeneration;
  displayedSpaces = [];
  countEl.textContent = String(spaces.filter(i => i.status !== 'done').length);

  const closedSpaces = spaces.filter(i => i.status === 'done');

  // Load timeline events
  let events: any[] = [];
  try {
    events = await whimAPI.listEvents(200);
  } catch { /* skip */ }

  if (gen !== renderGeneration) return;

  // Build a map of events per space
  const eventsBySpace = new Map<string, any[]>();
  for (const event of events) {
    const id = event.space_id;
    if (!id) continue;
    if (!eventsBySpace.has(id)) eventsBySpace.set(id, []);
    eventsBySpace.get(id)!.push(event);
  }

  // Also gather orphan events (no matching closed space)
  const closedIds = new Set(closedSpaces.map(i => i.id));

  if (closedSpaces.length === 0 && events.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="icon">📋</span>
        <span>No history yet.</span>
      </div>
    `;
    return;
  }

  // Sort closed spaces newest first by completed_at or updated_at
  const sorted = [...closedSpaces].sort((a, b) =>
    (b.completed_at || b.updated_at).localeCompare(a.completed_at || a.updated_at)
  );

  let html = '';

  for (const space of sorted) {
    const intentEvents = eventsBySpace.get(space.id) || [];
    // Sort events oldest first for step display
    intentEvents.sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));

    const hasSession = !!space.session_id;
    const typeIcon = hasSession ? '▶' : space.recurrence ? '↻' : '✓';
    const typeLabel = hasSession ? 'Session' : space.recurrence ? 'Recurring' : 'Completed';
    const completedAgo = space.completed_at ? timeAgo(space.completed_at) : timeAgo(space.updated_at);

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
        return `<div class="history-card-step"><span class="history-step-icon">${evIcon}</span><span>${evLabel}</span></div>`;
      });
      stepsHtml = `<div class="history-card-steps">${steps.join('<div class="history-step-connector"></div>')}</div>`;
    }

    html += `
      <div class="history-card" data-id="${space.id}" onclick="openCanvas('${space.id}', true)">
        <button class="history-card-restore" onclick="event.stopPropagation(); unarchiveIntent('${space.id}')" title="Restore to Spaces">↺</button>
        <div class="history-card-type"><span class="history-type-icon">${typeIcon}</span> ${typeLabel}</div>
        <div class="history-card-title">${escapeHtml(space.description)}</div>
        ${space.client ? `<div class="history-card-client">👤 ${escapeHtml(space.client)}</div>` : ''}
        ${stepsHtml}
        <div class="history-card-meta">${completedAgo}</div>
      </div>
    `;
  }

  // Add orphan timeline events not tied to a closed space
  const orphanEvents = events.filter(e => e.space_id && !closedIds.has(e.space_id));
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
      html += `<div class="history-date-label">${date}</div>`;
      for (const event of dateEvents) {
        const icon = event.event_type === 'completed' ? '✅' :
                     event.event_type === 'recycled' ? '↻' : '•';
        const desc = event.space_description ? escapeHtml(event.space_description) : 'Unknown';
        const time = new Date(event.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        html += `
          <div class="history-card history-card-mini">
            <div class="history-card-type"><span class="history-type-icon">${icon}</span> ${escapeHtml(event.event_type)}</div>
            <div class="history-card-title">${desc}</div>
            <div class="history-card-meta">${time}</div>
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
  const openTasks = spaces.filter(i => i.status !== 'done').length;
  const scheduled = spaces.filter(i => i.due_at_utc || i.due_at).length;
  const recurring = spaces.filter(i => i.recurrence).length;

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
const agentYoloState = new Map<string, boolean>();
const agentChatUnsubs = new Map<string, () => void>();

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : filePath;
}

function humanizeToolName(toolName: string, args?: Record<string, any>): string {
  const fileName = args?.path ? basename(args.path) : '';

  if (toolName === 'report_intent' && args?.whim) {
    return String(args.whim).slice(0, 80);
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
  const unsub = whimAPI.onChatEvent(agentId, (event: any) => {
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
      whimAPI.approveAgent(aid, rid, approved);
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
    cachedSkills = await whimAPI.listSkills();
    return cachedSkills;
  } catch {
    return cachedSkills;
  }
}

async function renderSkillsList(filterQuery?: string): Promise<void> {
  const gen = ++renderGeneration;
  displayedSpaces = [];
  countEl.textContent = String(spaces.filter(i => i.status !== 'done').length);

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
    <div class="space-item skill-card" data-skill-id="${skill.id}" tabindex="0" data-skill-index="${i}">
      <div class="skill-icon">${skill.emoji || '🧩'}</div>
      <div class="space-content">
        <div class="space-desc">${escapeHtml(skill.name)}</div>
        <div class="space-meta">
          <span>${escapeHtml(skill.description.length > 100 ? skill.description.slice(0, 97) + '...' : skill.description)}</span>
        </div>
      </div>
      <button class="space-launch" onclick="event.stopPropagation(); createSpaceFromSkill('${skill.id}')" title="Launch as new space">▶</button>
      <button class="space-launch" onclick="event.stopPropagation(); openSkillFolder('${skill.id}')" title="Open folder">📁</button>
      <button class="space-delete" onclick="event.stopPropagation(); deleteSkill('${skill.id}')">✕</button>
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

  const result = await whimAPI.createSkill(name.trim());
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
    whimAPI.openCanvasWindow({ kind: 'skill', id: skillId, title: skill.name });
    return;
  }

  // ── Below runs only inside the canvas popout window ──
  const result = await whimAPI.readSkill(skillId);
  if ('error' in result) {
    return;
  }

  canvasSpaceId = null;
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
  canvasOpenFolder.classList.add('hidden');

  canvasView.classList.remove('hidden');

  const myGen = ++canvasMountGen;
  const currentTheme = await whimAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark');

  if (canvasMountGen !== myGen) return;

  // Pass frontmatter and body separately — canvas renders them independently
  mountCanvas(canvasRoot, {
    spaceId: '__skill__' + skillId,
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

  await whimAPI.writeSkill(skillId, frontmatter, body);
}

async function openSkillFolder(skillId: string): Promise<void> {
  await whimAPI.openSkillFolder(skillId);
}

async function createSpaceFromSkill(skillId: string): Promise<void> {
  const result = await whimAPI.createSpaceFromSkill(skillId);
  if ('error' in result) {
    showStatus(`Failed: ${result.error}`, true);
    return;
  }
  showStatus(`✓ Created space from skill`);
  setTimeout(hideStatus, 2000);
  // Switch to Spaces tab first, then reload so render() uses the correct filter
  setFilter('open');
  await loadSpaces();
}

async function deleteSkill(skillId: string): Promise<void> {
  const skill = cachedSkills.find(s => s.id === skillId);
  if (!confirm(`Delete skill "${skill?.name || skillId}"?`)) return;

  await whimAPI.deleteSkill(skillId);
  render();
}

async function launchSkillAsSpace(skillId: string): Promise<void> {
  const result = await whimAPI.launchSkill(skillId);
  if ('error' in result) {
    showStatus(`Failed: ${result.error}`, true);
    return;
  }
  showStatus(`✓ Launched skill as new space`);
  setTimeout(hideStatus, 2000);
  // Switch to Spaces tab first, then reload so render() uses the correct filter
  setFilter('open');
  await loadSpaces();
  // Close the skill editor canvas if open in a popout
  if (isCanvasMode) {
    window.close();
  }
}

// Wire up skills changed event
whimAPI.onSkillsChanged(() => {
  if (currentFilter === 'skills') {
    renderSkillsList();
  }
});

// Expose skill functions to onclick handlers
(window as any).createNewSkill = createNewSkill;
(window as any).openSkillFolder = openSkillFolder;
(window as any).createSpaceFromSkill = createSpaceFromSkill;
(window as any).launchSkillAsSpace = launchSkillAsSpace;
(window as any).deleteSkill = deleteSkill;

async function renderAgentsList(filterQuery?: string): Promise<void> {
  const gen = ++renderGeneration;
  displayedSpaces = [];
  countEl.textContent = String(spaces.filter(i => i.status !== 'done').length);

  // Gather all agents (including workspace-level ones)
  let allAgents: Array<{ agentId: string; sessionId: string; status: string; summary: string; selectedText: string; spaceId: string; createdAt?: string; pendingApprovalId?: string | null; pendingPermissionKind?: string | null; source?: 'sdk' | 'cli' | 'cloud'; personaHandle?: string | null }> = [];

  try {
    allAgents = await whimAPI.listAllAgents();
  } catch {
    // Fallback: iterate spaces
    for (const space of spaces) {
      try {
        const agents = await whimAPI.listAgents(space.id);
        for (const agent of agents) {
          allAgents.push({ ...agent, spaceId: space.id });
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

  // Build space description map for display
  const intentMap = new Map(spaces.map(i => [i.id, i.description]));

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
    if ((agent as any).yoloMode) {
      agentYoloState.set(agent.agentId, true);
    }
  }

  listEl.innerHTML = allAgents.map(agent => {
    const statusClass = agent.status === 'running' ? 'agent-running' :
                        agent.status === 'waiting-approval' ? 'agent-waiting' :
                        agent.status === 'completed' ? 'agent-completed' :
                        'agent-failed';

    // Status icon always reflects agent state (not source)
    const statusIcon = agent.status === 'running' ? '<svg class="agent-icon-svg agent-icon-running" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" stroke="#a855f7" stroke-width="2" stroke-dasharray="12 38" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="0.8s" repeatCount="indefinite"/></circle><circle cx="9" cy="9" r="4" fill="#a855f7" opacity="0.3"/></svg>' :
                       agent.status === 'waiting-approval' ? '<svg class="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" fill="#f59e0b" opacity="0.15" stroke="#f59e0b" stroke-width="1.5"/><circle cx="9" cy="9" r="3.5" stroke="#f59e0b" stroke-width="1.5" fill="none"/><path d="M9 7V9.5L10.5 10.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' :
                       agent.status === 'completed' ? '<svg class="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#22c55e"/><path d="M5.5 9.5L7.8 11.8L12.5 6.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' :
                       '<svg class="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#ef4444"/><path d="M6 6L12 12M12 6L6 12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>';

    // Source label (cloud/cli/local)
    const sourceLabel = agent.source === 'cloud' ? '<span class="agent-card-source">☁️ Cloud</span>'
      : agent.source === 'cli' ? '<span class="agent-card-source">🖥 CLI</span>'
      : '';

    const intentLabel = agent.source === 'cli'
      ? 'CLI Session'
      : agent.source === 'cloud'
        ? 'Cloud Agent'
        : agent.spaceId === '__workspace__'
          ? 'Workspace'
          : escapeHtml(intentMap.get(agent.spaceId) || agent.spaceId);

    const title = agent.selectedText.length > 80
      ? agent.selectedText.slice(0, 77) + '...'
      : agent.selectedText;

    // Look up persona emoji
    const personaEmoji = agent.personaHandle
      ? (personas.find(p => p.handle === agent.personaHandle)?.emoji || '')
      : '';

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

    const canvasBtn = agent.spaceId && agent.spaceId !== '__workspace__' && agent.source !== 'cli'
      ? `<button class="agent-card-canvas-btn" data-space-id="${agent.spaceId}" title="Open canvas">📄</button>`
      : '';

    const isYolo = agentYoloState.get(agent.agentId) || false;
    const yoloBtn = (agent.status === 'running' || agent.status === 'waiting-approval')
      ? `<button class="agent-card-yolo-btn${isYolo ? ' active' : ''}" data-agent-id="${agent.agentId}" title="${isYolo ? 'Yolo mode ON — click to disable' : 'Enable yolo mode (auto-approve all)'}">🔥</button>`
      : '';

    // Only show summary when it adds information beyond the status
    const trivialSummaries = ['Completed', 'Failed', 'Starting...', ''];
    const showSummary = (agent.status === 'completed' || agent.status === 'failed') && agent.summary && !trivialSummaries.includes(agent.summary);

    return `
      <div class="agent-card ${statusClass}" data-agent-id="${agent.agentId}" title="Click to open chat">
        <div class="agent-card-header">
          <span class="agent-card-icon">${statusIcon}</span>
          <span class="agent-card-name">${intentLabel}</span>
          ${sourceLabel}
          <div class="agent-card-actions">
            ${yoloBtn}
            ${canvasBtn}
            <button class="agent-card-delete-btn" data-agent-id="${agent.agentId}" title="Delete session">✕</button>
          </div>
        </div>
        <div class="agent-card-title">${personaEmoji ? `<span class="agent-card-persona-emoji">${personaEmoji}</span> ` : ''}${escapeHtml(title)}</div>
        ${stepsHtml ? `<div class="agent-card-steps">${stepsHtml}</div>` : ''}
        ${showSummary ? `<div class="agent-card-summary">${escapeHtml(agent.summary)}</div>` : ''}
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
        openAgentChat(agentId, agent.selectedText, agent.status, agent.source, agent.spaceId);
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
      whimAPI.approveAgent(aid, rid, approved);
      agentApprovals.delete(aid);
      updateAgentCardApproval(aid);
    });
  });

  // Wire up delete session handlers
  listEl.querySelectorAll('.agent-card-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const aid = (e.currentTarget as HTMLElement).dataset.agentId!;
      await whimAPI.deleteAgentSession(aid);
      renderAgentsList();
    });
  });

  // Wire up canvas button handlers
  listEl.querySelectorAll('.agent-card-canvas-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const spaceId = (e.currentTarget as HTMLElement).dataset.spaceId!;
      openCanvas(spaceId, true);
    });
  });

  // Wire up yolo toggle handlers
  listEl.querySelectorAll('.agent-card-yolo-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const aid = (e.currentTarget as HTMLElement).dataset.agentId!;
      const current = agentYoloState.get(aid) || false;
      whimAPI.setAgentYolo(aid, !current);
    });
  });

  // Subscribe to chat events for live agents
  for (const agent of allAgents) {
    if (agent.status === 'running' || agent.status === 'waiting-approval') {
      subscribeAgentChat(agent.agentId);
    }
  }
}

let renderedAgents: Array<{ agentId: string; sessionId: string; status: string; summary: string; selectedText: string; spaceId: string; createdAt?: string; source?: 'sdk' | 'cli' | 'cloud' }> = [];

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
  const items = listEl.querySelectorAll('.space-item');
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

    // Extract a leading @persona mention if present.  State (set when the
    // user picks from the dropdown or types a complete handle) is the
    // authoritative source; raw-text parse is a fallback for hand-typed
    // handles that survived the dropdown hide.
    const raw = descInput.value;
    const mentionMatch = raw.match(/^@([a-z0-9][a-z0-9-]{0,31})(?:\s+([\s\S]*))?$/i);
    let promptText = text;
    let personaHandleArg: string | undefined;
    if (mentionMatch) {
      const candidate = mentionMatch[1].toLowerCase();
      const fromState = selectedPersonaHandle && selectedPersonaHandle.toLowerCase() === candidate ? selectedPersonaHandle : null;
      const persona = fromState ? findExactPersona(fromState) : findExactPersona(candidate);
      if (persona) {
        personaHandleArg = persona.handle;
        promptText = (mentionMatch[2] || '').trim();
        if (!promptText) {
          // User hit submit with only "@handle" and no follow-up — open an
          // empty chat seeded with the persona instead of launching with no work.
          openAgentChat(undefined as any, '', 'new');
          return;
        }
      }
    }

    showStatus(personaHandleArg ? `⚡ Launching @${personaHandleArg}...` : '⚡ Launching agent...');
    const result = await whimAPI.quickLaunchAgent(promptText, personaHandleArg);
    if ('error' in result && result.error) {
      if (result.error === 'no_workspace') {
        showStatus('Select a workspace directory first');
        const ws = await whimAPI.selectWorkspace();
        if (ws.selected) updateWorkspaceDisplay(ws.path!);
      } else {
        showStatus(`Failed: ${result.error}`, true);
      }
      return;
    }
    descInput.value = '';
    descInput.style.height = 'auto';
    selectedPersonaHandle = null;
    hideMentionDropdown();
    descInput.focus();
    hideStatus();
    renderAgentsList();
    return;
  }

  // ── Skills tab: create a skill from description ───────
  if (currentFilter === 'skills') {
    if (!text) return; // require a description
    showStatus('✨ Creating skill...');
    const result = await whimAPI.createSkillFromPrompt(text);
    if ('error' in result && result.error) {
      if (result.error === 'no_workspace') {
        showStatus('Select a workspace directory first');
        const ws = await whimAPI.selectWorkspace();
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

  // ── Spaces tab: create an space (original behavior) ──
  if (!text) return;

  descInput.value = '';
  descInput.style.height = 'auto';
  descInput.focus();
  searchResults = null;

  // Create as space with body
  queryResult.classList.add('hidden');
  listEl.classList.remove('hidden');
  const space = await whimAPI.create({ body: text }) as any;
  if (space.error === 'no_workspace') {
    showStatus('Select a workspace directory first');
    const ws = await whimAPI.selectWorkspace();
    if (ws.selected) {
      updateWorkspaceDisplay(ws.path!);
      const retryIntent = await whimAPI.create({ body: text }) as any;
      if (retryIntent.error) {
        showStatus('Failed to create space', true);
        return;
      }
      processingSpaces.add(retryIntent.id);
    } else {
      hideStatus();
      return;
    }
  } else {
    processingSpaces.add(space.id);
  }
  hideStatus();
  await loadSpaces();
});

// Listen for background LLM processing completion
whimAPI.onSpaceProcessed(async (id: string) => {
  processingSpaces.delete(id);
  await animateRefinement(id);
});

// Listen for recurrence evaluation results
whimAPI.onRecurrenceResult((spaceId: string, result: RecurrenceResult) => {
  if (!result.should_recur) return;

  const dueText = result.next_due || result.next_due_utc || 'soon';
  statusBar.innerHTML = `↻ Recurring — next due ${escapeHtml(dueText)} <button class="dismiss-recurrence" onclick="dismissRecurrence('${spaceId}')">✕</button>`;
  statusBar.classList.remove('hidden', 'error');
  statusBar.classList.add('recurrence');
});

// Listen for recurrence being applied (after undo window)
whimAPI.onRecurrenceApplied(async (_intentId: string) => {
  hideStatus();
  await loadSpaces();
});

// Listen for recall hints
whimAPI.onRecallHint((spaceId: string, match: RecallMatch) => {
  const hintEl = listEl.querySelector(`[data-recall-for="${spaceId}"]`) as HTMLElement | null;
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
async function dismissRecurrence(spaceId: string): Promise<void> {
  await whimAPI.dismissRecurrence(spaceId);
  hideStatus();
}

(window as any).dismissRecurrence = dismissRecurrence;

// ── Session launch ──────────────────────────────────────
// @ts-ignore - called from onclick in HTML
async function launchSession(spaceId: string): Promise<void> {
  const result = await whimAPI.launchSession(spaceId);
  if (result.success) {
    whimAPI.hideWindow();
    await loadSpaces();
  } else if (result.error === 'no_workspace') {
    // Prompt to select workspace
    showStatus('Select a workspace directory first');
    const ws = await whimAPI.selectWorkspace();
    if (ws.selected) {
      updateWorkspaceDisplay(ws.path!);
      // Retry launch
      const retry = await whimAPI.launchSession(spaceId);
      if (retry.success) {
        whimAPI.hideWindow();
        await loadSpaces();
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
  const result = await whimAPI.selectWorkspace();
  if (result.selected) {
    updateWorkspaceDisplay(result.path);
  }
});

workspaceClearBtn.addEventListener('click', async () => {
  await whimAPI.clearWorkspace();
  updateWorkspaceDisplay(null);
});

workspacePathEl.addEventListener('click', () => {
  const path = workspacePathEl.title;
  if (path) {
    whimAPI.openPath(path);
  }
});

// ── CLI Path setting ────────────────────────────────────
const cliPathInput = document.getElementById('cli-path-input') as HTMLInputElement;
const cliPathClear = document.getElementById('cli-path-clear') as HTMLButtonElement;
const cliPathDetected = document.getElementById('cli-path-detected') as HTMLSpanElement;

async function loadCliPathSetting(): Promise<void> {
  const override = await whimAPI.getSetting('cli_path');
  const info = await whimAPI.checkCliVersion();

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
  await updateCliMxcIndicator();
}

async function updateCliPathDetected(): Promise<void> {
  const info = await whimAPI.checkCliVersion();
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
    const resolved = await whimAPI.setSetting('cli_path', val);
    // Update input to show the resolved full path if it changed
    if (resolved && resolved !== val) {
      cliPathInput.value = resolved;
    }
    cliPathClear.classList.toggle('hidden', !cliPathInput.value);
    await updateCliPathDetected();
    await updateCliMxcIndicator();
  }, 500);
});

cliPathClear.addEventListener('click', async () => {
  cliPathInput.value = '';
  await whimAPI.setSetting('cli_path', '');
  cliPathClear.classList.add('hidden');
  await updateCliPathDetected();
  await updateCliMxcIndicator();
});

// ── MXC capability indicator ────────────────────────────
const cliMxcIndicator = document.getElementById('cli-mxc-indicator') as HTMLSpanElement | null;

async function updateCliMxcIndicator(): Promise<void> {
  if (!cliMxcIndicator) return;
  const platform = whimAPI.getPlatform();
  if (platform !== 'win32') {
    cliMxcIndicator.textContent = 'unavailable on this platform';
    cliMxcIndicator.className = 'cli-mxc-indicator';
    return;
  }
  try {
    const r = await whimAPI.checkCliMxcCapable();
    if (r.mxcCapable) {
      cliMxcIndicator.textContent = '✓ supported (this CLI build ships @microsoft/mxc-sdk)';
      cliMxcIndicator.className = 'cli-mxc-indicator ok';
    } else {
      cliMxcIndicator.textContent = '⚠ not detected — sandboxed personas will fall back to host-side path enforcement only';
      cliMxcIndicator.className = 'cli-mxc-indicator warn';
    }
  } catch {
    cliMxcIndicator.textContent = '?';
    cliMxcIndicator.className = 'cli-mxc-indicator';
  }
}

// ── Settings tabs ───────────────────────────────────────
const SETTINGS_TAB_KEY = 'whim.settingsTab';
function initSettingsTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.settings-tab-btn');
  const panels = document.querySelectorAll<HTMLElement>('.settings-tab-panel');
  if (!tabs.length || !panels.length) return;
  const stored = localStorage.getItem(SETTINGS_TAB_KEY);
  const activate = (name: string) => {
    let matched = false;
    tabs.forEach(t => {
      const isActive = t.dataset.tab === name;
      t.classList.toggle('active', isActive);
      if (isActive) matched = true;
    });
    panels.forEach(p => {
      p.classList.toggle('active', p.dataset.tab === name);
    });
    if (matched) {
      try { localStorage.setItem(SETTINGS_TAB_KEY, name); } catch { /* ignore */ }
    }
  };
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      if (t.dataset.tab) activate(t.dataset.tab);
    });
  });
  if (stored) {
    activate(stored);
  }
  // Fallback: if no tab is active (e.g. stored tab was removed), activate general
  const anyActive = Array.from(tabs).some(t => t.classList.contains('active'));
  if (!anyActive) activate('general');
}
initSettingsTabs();

// ── Sandbox policy form helpers ─────────────────────────

function pathListToTextarea(paths: string[]): string {
  return (paths || []).join('\n');
}

function textareaToPathList(text: string): string[] {
  return text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0).slice(0, 64);
}

/**
 * Render an editable sandbox-policy form into `container`. Returns a
 * `getPolicy()` accessor that reads the current values back as a SandboxPolicy.
 */
function renderSandboxPolicyForm(
  container: HTMLElement,
  initial: SandboxPolicy,
  opts?: { idPrefix?: string },
): { getPolicy: () => SandboxPolicy; setPolicy: (p: SandboxPolicy) => void } {
  const id = (s: string) => `${opts?.idPrefix ?? 'sandbox'}-${s}`;
  container.innerHTML = '';

  function checkbox(name: string, label: string, checked: boolean, hint?: string): HTMLInputElement {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id(name);
    cb.checked = checked;
    lbl.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = label;
    lbl.appendChild(span);
    container.appendChild(lbl);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'sandbox-field-hint';
      h.textContent = hint;
      container.appendChild(h);
    }
    return cb;
  }

  function pathTextarea(name: string, label: string, value: string[], hint?: string): HTMLTextAreaElement {
    const title = document.createElement('div');
    title.className = 'sandbox-section-title';
    title.textContent = label;
    container.appendChild(title);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'sandbox-field-hint';
      h.textContent = hint;
      container.appendChild(h);
    }
    const ta = document.createElement('textarea');
    ta.id = id(name);
    ta.value = pathListToTextarea(value);
    ta.placeholder = 'One path per line';
    ta.spellcheck = false;
    container.appendChild(ta);
    return ta;
  }

  // Filesystem section
  const fsTitle = document.createElement('div');
  fsTitle.className = 'sandbox-section-title';
  fsTitle.textContent = 'Filesystem';
  container.appendChild(fsTitle);

  const scopeBox = checkbox(
    'scope',
    'Read & write inside the space folder',
    initial.scopeToSpaceFolder,
    'When checked, the agent can read and write anywhere inside its space folder. Recommended ON.',
  );
  const rwArea = pathTextarea('rw', 'Extra read-write paths', initial.extraReadwritePaths,
    'Optional. Each line is an absolute path the agent may read AND write.');
  const roArea = pathTextarea('ro', 'Extra read-only paths', initial.extraReadonlyPaths,
    'Optional. Each line is an absolute path the agent may read only.');
  const denyArea = pathTextarea('deny', 'Denied paths', initial.extraDeniedPaths,
    'Optional. Each line is an absolute path the agent must never access (overrides RW/RO).');

  // Tool surface section
  const toolsTitle = document.createElement('div');
  toolsTitle.className = 'sandbox-section-title';
  toolsTitle.textContent = 'Tool surface';
  container.appendChild(toolsTitle);

  const mcpBox = checkbox(
    'mcp',
    'Allow MCP servers',
    initial.allowMcpServers,
    'When unchecked, sandboxed agents launch with MCP servers hidden. Default OFF.',
  );
  const wfBox = checkbox(
    'web-fetch',
    'Allow web_fetch tool',
    initial.allowWebFetch,
    'When unchecked, sandboxed agents launch without the web_fetch tool. Default OFF.',
  );

  // Network section
  const netTitle = document.createElement('div');
  netTitle.className = 'sandbox-section-title';
  netTitle.textContent = 'Network (applies to shell sandbox)';
  container.appendChild(netTitle);

  const outBox = checkbox(
    'allow-out',
    'Allow outbound network',
    initial.allowOutbound,
    'When checked, shell commands inside the sandbox may reach the internet (e.g. git fetch). Default OFF.',
  );
  const localBox = checkbox(
    'allow-local',
    'Allow local network',
    initial.allowLocalNetwork,
    'When checked, shell commands may reach localhost / LAN. Default OFF.',
  );

  // Enforcement section — lets the user pick between defense-in-depth (host
  // guards on top of MXC) and MXC-only (test mode that disables host guards
  // so denials come from MXC's AppContainer alone).
  const enforceTitle = document.createElement('div');
  enforceTitle.className = 'sandbox-section-title';
  enforceTitle.textContent = 'Enforcement';
  container.appendChild(enforceTitle);

  const enforceWrap = document.createElement('label');
  const enforceLbl = document.createElement('span');
  enforceLbl.textContent = 'Enforcement mode';
  enforceWrap.appendChild(enforceLbl);
  const enforceSelect = document.createElement('select');
  enforceSelect.id = id('enforcement');
  const optBoth = document.createElement('option');
  optBoth.value = 'both';
  optBoth.textContent = 'Both: host guards + MXC (Recommended)';
  enforceSelect.appendChild(optBoth);
  const optMxc = document.createElement('option');
  optMxc.value = 'mxc-only';
  optMxc.textContent = 'MXC only (test mode — host guards disabled)';
  enforceSelect.appendChild(optMxc);
  enforceSelect.value = initial.enforcementMode === 'mxc-only' ? 'mxc-only' : 'both';
  enforceWrap.appendChild(enforceSelect);
  container.appendChild(enforceWrap);

  const enforceHint = document.createElement('div');
  enforceHint.className = 'sandbox-field-hint';
  enforceHint.textContent =
    'Both: host-side read-only classifier + path-policy hook deny most things before MXC sees them. ' +
    'MXC only: skip those host guards so MXC AppContainer is the sole enforcer for shell commands. ' +
    'Use MXC-only to verify MXC is actually doing the work — note that path-bearing SDK tools ' +
    '(view/edit/create/glob/grep) are NOT covered by MXC and become unrestricted in this mode.';
  container.appendChild(enforceHint);

  const enforceWarn = document.createElement('div');
  enforceWarn.className = 'sandbox-field-hint';
  enforceWarn.style.color = '#c0392b';
  enforceWarn.style.fontWeight = '600';
  enforceWarn.textContent = '⚠ MXC-only is a test mode. Use only to verify MXC enforcement; less safe than Both.';
  enforceWarn.style.display = enforceSelect.value === 'mxc-only' ? '' : 'none';
  container.appendChild(enforceWarn);
  enforceSelect.addEventListener('change', () => {
    enforceWarn.style.display = enforceSelect.value === 'mxc-only' ? '' : 'none';
  });

  function getPolicy(): SandboxPolicy {
    return {
      scopeToSpaceFolder: scopeBox.checked,
      extraReadwritePaths: textareaToPathList(rwArea.value),
      extraReadonlyPaths: textareaToPathList(roArea.value),
      extraDeniedPaths: textareaToPathList(denyArea.value),
      allowMcpServers: mcpBox.checked,
      allowWebFetch: wfBox.checked,
      allowOutbound: outBox.checked,
      allowLocalNetwork: localBox.checked,
      enforcementMode: enforceSelect.value === 'mxc-only' ? 'mxc-only' : 'both',
    };
  }

  function setPolicy(p: SandboxPolicy): void {
    scopeBox.checked = p.scopeToSpaceFolder;
    rwArea.value = pathListToTextarea(p.extraReadwritePaths);
    roArea.value = pathListToTextarea(p.extraReadonlyPaths);
    denyArea.value = pathListToTextarea(p.extraDeniedPaths);
    mcpBox.checked = p.allowMcpServers;
    wfBox.checked = p.allowWebFetch;
    outBox.checked = p.allowOutbound;
    localBox.checked = p.allowLocalNetwork;
    enforceSelect.value = p.enforcementMode === 'mxc-only' ? 'mxc-only' : 'both';
    enforceWarn.style.display = enforceSelect.value === 'mxc-only' ? '' : 'none';
  }

  return { getPolicy, setPolicy };
}

// ── Default sandbox policy form (now managed through @agent editor) ──
// Legacy function kept as no-op for any remaining calls
let sandboxDefaultFormApi: { getPolicy: () => SandboxPolicy; setPolicy: (p: SandboxPolicy) => void } | null = null;

async function renderDefaultSandboxPolicyForm(): Promise<void> {
  // No-op: sandbox policy is now configured through the @agent editor in the Agents tab
}
renderDefaultSandboxPolicyForm();

// ── Inline editing ──────────────────────────────────────
// @ts-ignore - called from onclick in HTML
async function editDate(spaceId: string): Promise<void> {
  const space = spaces.find(i => i.id === spaceId);
  if (!space) return;

  const itemEl = listEl.querySelector(`[data-id="${spaceId}"]`);
  const badge = itemEl?.querySelector('.due-badge') as HTMLElement;
  if (!badge || badge.querySelector('input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input inline-edit-date';
  input.placeholder = 'e.g. next Friday, May 1...';
  input.value = space.due_at || '';

  badge.textContent = '';
  badge.appendChild(input);
  input.focus();
  input.select();

  const save = async () => {
    const dateText = input.value.trim();
    if (dateText) {
      badge.textContent = '📅 resolving...';
      const resolved = await whimAPI.resolveDate(dateText);
      await whimAPI.update(spaceId, { due_at: resolved.due_at, due_at_utc: resolved.due_at_utc });
    } else {
      // Clear the date
      await whimAPI.update(spaceId, { due_at: null, due_at_utc: null });
    }
    await loadSpaces();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { loadSpaces(); }
  });
  input.addEventListener('blur', save);
}

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

async function editBody(spaceId: string): Promise<void> {
  const space = spaces.find(i => i.id === spaceId);
  if (!space || !space.body) return;

  const itemEl = listEl.querySelector(`[data-id="${spaceId}"]`);
  let bodyEl = itemEl?.querySelector('.whim-body') as HTMLElement | null;

  // If no body element exists, create one
  const contentEl = itemEl?.querySelector('.whim-content') as HTMLElement;
  if (!contentEl) return;

  if (!bodyEl) {
    bodyEl = document.createElement('div');
    bodyEl.className = 'space-body expanded';
    const descEl = contentEl.querySelector('.whim-desc');
    if (descEl) descEl.after(bodyEl);
    else contentEl.prepend(bodyEl);
  }

  if (bodyEl.querySelector('textarea')) return; // Already editing

  const textarea = document.createElement('textarea');
  textarea.className = 'inline-edit-body';
  textarea.value = space.body;
  textarea.rows = Math.min(space.body.split('\n').length + 1, 8);

  bodyEl.innerHTML = '';
  bodyEl.classList.remove('collapsed');
  bodyEl.classList.add('expanded');
  bodyEl.appendChild(textarea);
  textarea.focus();

  const save = async () => {
    const newBody = textarea.value.trim();
    if (newBody && newBody !== space.body) {
      await whimAPI.update(spaceId, { body: newBody });
    }
    await loadSpaces();
  };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { loadSpaces(); }
  });
  textarea.addEventListener('blur', save);
}

(window as any).editBody = editBody;

// ── Attachments ─────────────────────────────────────────
async function addAttachment(spaceId: string): Promise<void> {
  const space = spaces.find(i => i.id === spaceId);
  if (!space) return;

  const itemEl = listEl.querySelector(`[data-id="${spaceId}"]`);
  const contentEl = itemEl?.querySelector('.whim-content') as HTMLElement;
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

  const metaEl = contentEl.querySelector('.whim-meta');
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
      const attachments = [...(space.attachments || []), { type: 'url' as const, name, url }];
      await whimAPI.update(spaceId, { attachments });
    } else if (url) {
      // Not a valid URL — just remove the input
    }
    row.remove();
    await loadSpaces();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { row.remove(); }
  });
  input.addEventListener('blur', save);
}

async function removeAttachment(spaceId: string, index: number): Promise<void> {
  const space = spaces.find(i => i.id === spaceId);
  if (!space) return;
  const attachments = [...(space.attachments || [])];
  attachments.splice(index, 1);
  await whimAPI.update(spaceId, { attachments });
  await loadSpaces();
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
async function setFocus(spaceId: string): Promise<void> {
  if (focusedSpaceId === spaceId) {
    // Toggle off
    clearFocus();
    return;
  }
  focusedSpaceId = spaceId;
  await whimAPI.setSetting('focused_intent', spaceId);
  updateFocusBanner();
  render();
}

function clearFocus(): void {
  focusedSpaceId = null;
  whimAPI.setSetting('focused_intent', '');
  focusBanner.classList.add('hidden');
  render();
}

function updateFocusBanner(): void {
  if (!focusedSpaceId) {
    focusBanner.classList.add('hidden');
    return;
  }
  const space = spaces.find(i => i.id === focusedSpaceId);
  if (!space || space.status === 'done') {
    clearFocus();
    return;
  }

  const dueInfo = formatDueDate(space.due_at_utc, space.due_at);
  focusDesc.textContent = space.description;
  let meta = '';
  if (space.client) meta += `👤 ${space.client}  `;
  if (dueInfo.text) meta += `📅 ${dueInfo.text}`;
  focusMeta.textContent = meta;
  focusBanner.classList.remove('hidden');
}

focusDone.addEventListener('click', async () => {
  if (!focusedSpaceId) return;
  await whimAPI.update(focusedSpaceId, { status: 'done' });
  clearFocus();
  await loadSpaces();
});

focusClear.addEventListener('click', clearFocus);

async function loadFocusState(): Promise<void> {
  const saved = await whimAPI.getSetting('focused_intent');
  if (saved) {
    focusedSpaceId = saved;
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
  const events = await whimAPI.listEvents(200);

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
      const desc = event.space_description ? escapeHtml(event.space_description) : 'Unknown space';
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
  const space = spaces.find(i => i.id === id);
  if (!space) return;
  const newStatus = space.status === 'done' ? 'captured' : 'done';
  await whimAPI.update(id, { status: newStatus });
  await loadSpaces();
}

// @ts-ignore - called from onclick in HTML
async function deleteSpace(id: string): Promise<void> {
  if (!confirm('Delete this space? Its folder and files will be permanently removed.')) return;
  await whimAPI.delete(id);
  await loadSpaces();
}

(window as any).toggleStatus = toggleStatus;
(window as any).deleteSpace = deleteSpace;

// @ts-ignore - called from onclick in HTML
async function unarchiveIntent(id: string): Promise<void> {
  const result = await whimAPI.unarchive(id);
  if (result) {
    showStatus('✓ Restored to Spaces');
    setTimeout(hideStatus, 2000);
    await loadSpaces();
  }
}

(window as any).unarchiveIntent = unarchiveIntent;

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
const canvasPinTopBtn = document.getElementById('canvas-pin-top') as HTMLButtonElement;
const canvasOpenFolder = document.getElementById('canvas-open-folder') as HTMLButtonElement;
const modeToggleRendered = document.getElementById('mode-toggle-rendered') as HTMLButtonElement;
const modeToggleRaw = document.getElementById('mode-toggle-raw') as HTMLButtonElement;
const canvasAgentsPanel = document.getElementById('canvas-agents-panel') as HTMLDivElement;
const canvasAgentsClose = document.getElementById('canvas-agents-close') as HTMLButtonElement;
const canvasAgentsList = document.getElementById('canvas-agents-list') as HTMLDivElement;
let canvasSpaceId: string | null = null;
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
  } else if (newTitle !== titleBeforeEdit && canvasSpaceId) {
    canvasTitle.textContent = newTitle;
    await whimAPI.update(canvasSpaceId, { description: newTitle });
    await loadSpaces();
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
  if (!canvasSpaceId) return;
  const content = getCanvasContent();
  if (!content.trim()) return;
  canvasTitleAI.disabled = true;
  canvasTitleAI.textContent = '⏳';
  try {
    const result = await whimAPI.summarizeTitle(content);
    if (result.title) {
      canvasTitle.textContent = result.title;
      canvasTitle.focus();
    }
  } finally {
    canvasTitleAI.disabled = false;
    canvasTitleAI.textContent = '✨';
  }
});

// Create a new blank space and immediately open it in the full canvas editor
async function createAndOpenCanvas(): Promise<void> {
  const space = await whimAPI.create({ body: '' }) as any;
  if (space.error === 'no_workspace') {
    showStatus('Select a workspace directory first');
    const ws = await whimAPI.selectWorkspace();
    if (!ws.selected) { hideStatus(); return; }
    updateWorkspaceDisplay(ws.path!);
    const retry = await whimAPI.create({ body: '' }) as any;
    if (retry.error) { showStatus('Failed to create space', true); return; }
    await loadSpaces();
    openCanvas(retry.id, true);
    canvasIsNewIntent = true;
    return;
  }
  await loadSpaces();
  openCanvas(space.id, true);
  canvasIsNewIntent = true;
}

async function openCanvas(spaceId: string, expanded = false): Promise<void> {
  const space = spaces.find(i => i.id === spaceId);
  if (!space) return;

  // In main window, always pop out to separate canvas window
  if (!isCanvasMode) {
    whimAPI.openCanvasWindow({ kind: 'space', id: spaceId, title: space.description });
    return;
  }

  // ── Below runs only inside the canvas popout window ──
  canvasSpaceId = spaceId;
  canvasSkillId = null;
  canvasTitle.textContent = space.description;
  canvasTitle.contentEditable = 'false';
  canvasTitle.classList.remove('editing');
  canvasTitleAI.classList.add('hidden');
  canvasSaveStatus.textContent = '';
  canvasDirty = false;
  canvasSaveBtn.classList.add('hidden');
  updateModeToggleUI('rendered');

  // Show space-specific controls
  canvasLaunchBtn.classList.remove('hidden');
  canvasLaunchBtn.title = 'Start session';
  canvasAgentsBtn.classList.remove('hidden');
  canvasHistoryBtn.classList.remove('hidden');
  canvasOpenFolder.classList.remove('hidden');

  canvasView.classList.remove('hidden');

  const myGen = ++canvasMountGen;

  // Load all data in parallel
  const [result, currentTheme, canvasPersonas] = await Promise.all([
    whimAPI.readCanvas(spaceId),
    whimAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark'),
    whimAPI.listPersonas().then(p => p || []),
  ]);

  // Abort if user already switched to another space
  if (canvasMountGen !== myGen) return;

  if (result.error === 'no_workspace') {
    return;
  }

  // Mount Documint editor
  mountCanvas(canvasRoot, {
    spaceId,
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
        whimAPI.launchCommentAgent(
          spaceId,
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
  const spaceId = canvasSpaceId;
  const wasNewIntent = canvasIsNewIntent;
  const skillId = canvasSkillId;
  canvasSpaceId = null;
  canvasSkillId = null;
  canvasIsNewIntent = false;
  canvasClosing = true;

  // Get content BEFORE unmounting — use saved content if we were previewing
  const finalContent = wasPreviewActive ? (savedContent || '') : getCanvasContent();
  await unmountCanvas();

  if (skillId) {
    // Save skill content
    await saveSkillFromCanvas(skillId, finalContent);
  } else if (spaceId) {
    await whimAPI.closeCanvas(spaceId, finalContent);

    // If this was a new space created from Enter on empty input,
    // trigger AI refinement using the canvas content as the body
    if (wasNewIntent && finalContent.trim()) {
      await whimAPI.update(spaceId, { body: finalContent.trim() });
      processingSpaces.add(spaceId);
    } else if (wasNewIntent && !finalContent.trim()) {
      // Empty canvas — delete the blank space
      await whimAPI.delete(spaceId);
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

canvasOpenFolder.addEventListener('click', () => {
  if (canvasSpaceId) {
    whimAPI.openSpaceFolder(canvasSpaceId);
  }
});

canvasLaunchBtn.addEventListener('click', async () => {
  if (canvasSkillId) {
    // Skill mode: create space from skill + launch session
    await launchSkillAsSpace(canvasSkillId);
  } else if (canvasSpaceId) {
    // Save any pending edits before launching
    await saveCanvasEditor();

    // Launch SDK agent with full document context and open chat
    const result = await whimAPI.launchDocumentAgent(canvasSpaceId);
    if ('error' in result) {
      showStatus(result.error || 'Launch failed', true);
      setTimeout(hideStatus, 3000);
      return;
    }
    // Close the canvas view and open the chat
    closeCanvas();
    openAgentChat(result.agentId, 'Executing document...', 'running', 'sdk', canvasSpaceId || undefined);
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
  if (!canvasSpaceId) return;
  closeAgentsPanel();
  canvasHistoryPanel.classList.remove('hidden');
  canvasHistoryBtn.classList.add('active');
  historyPanelOpen = true;
  canvasHistoryList.innerHTML = '<div class="history-loading">Loading history…</div>';

  const result = await whimAPI.canvasHistory(canvasSpaceId);
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
    if (!canvasSpaceId) return;

    restoreBtn.disabled = true;
    restoreBtn.textContent = '…';

    const result = await whimAPI.canvasRestore(canvasSpaceId, commit.sha);
    if (result.success) {
      // Exit preview mode if active (content is now the restored version)
      if (previewActive) {
        previewActive = false;
        previewSha = null;
        previewSavedContent = null;
        canvasPreviewBanner.classList.add('hidden');
      }
      // Reload the canvas with restored content — re-mount in place
      const readResult = await whimAPI.readCanvas(canvasSpaceId!);
      if (!readResult.error) {
        const spaceId = canvasSpaceId!;
        await unmountCanvas();
        canvasSpaceId = null;
        await openCanvas(spaceId);
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
  if (!canvasSpaceId) return;

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
  const result = await whimAPI.canvasPreviewVersion(canvasSpaceId, commit.sha);
  if (result.error) return;

  const spaceId = canvasSpaceId!;
  await unmountCanvas();
  const currentTheme = await whimAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark');
  mountCanvas(canvasRoot, {
    spaceId,
    content: result.content,
    theme: currentTheme,
    onDirtyChange: () => {},   // no-op: preview edits are not tracked
    onSaveStatus: () => {},    // no-op: preview edits are not saved
  });
}

async function exitPreview(): Promise<void> {
  if (!previewActive || !canvasSpaceId) return;

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
  const spaceId = canvasSpaceId!;
  await unmountCanvas();
  const currentTheme = await whimAPI.getSetting('theme').then(t => (t || 'light') as 'light' | 'dark');
  const canvasPersonas = await whimAPI.listPersonas().then(p => p || []);
  mountCanvas(canvasRoot, {
    spaceId,
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
        whimAPI.launchCommentAgent(
          spaceId,
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
  if (!previewActive || !previewSha || !canvasSpaceId) return;

  const sha = previewSha;
  canvasPreviewRestore.disabled = true;
  canvasPreviewRestore.textContent = '…';

  const result = await whimAPI.canvasRestore(canvasSpaceId, sha);
  if (result.success) {
    previewActive = false;
    previewSha = null;
    previewSavedContent = null;
    canvasPreviewBanner.classList.add('hidden');

    const readResult = await whimAPI.readCanvas(canvasSpaceId!);
    if (!readResult.error) {
      const spaceId = canvasSpaceId!;
      await unmountCanvas();
      canvasSpaceId = null;
      await openCanvas(spaceId);
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
whimAPI.onWorkspaceCommitted(() => {
  if (historyPanelOpen && canvasSpaceId) {
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
  if (!canvasSpaceId) return;
  closeHistoryPanel();
  canvasAgentsPanel.classList.remove('hidden');
  canvasAgentsBtn.classList.add('active');
  agentsPanelOpen = true;
  canvasAgentsList.innerHTML = '<div class="history-loading">Loading sessions…</div>';

  let agents: Array<{ agentId: string; sessionId: string; status: string; summary: string; selectedText: string; createdAt?: string }> = [];
  try {
    agents = await whimAPI.listAgents(canvasSpaceId);
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
        if (isCanvasMode) {
          // Open the chat in the main panel so the canvas stays visible
          whimAPI.openAgentChatInPanel({ agentId, agentPrompt: agent.selectedText, agentStatus: agent.status, spaceId: canvasSpaceId || undefined });
        } else {
          openAgentChat(agentId, agent.selectedText, agent.status, undefined, canvasSpaceId || undefined);
        }
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

async function openAgentChat(agentId: string | undefined, agentPrompt: string, agentStatus: string, agentSource?: 'sdk' | 'cli', spaceId?: string): Promise<void> {
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
    spaceId,
    pendingApprovalId: approval?.requestId,
    pendingPermissionKind: approval?.permissionKind,
    onClose: () => closeAgentChat(),
    onOpenCli: (id: string) => whimAPI.openAgentCli(id),
    onOpenCanvas: spaceId ? (id: string) => {
      const space = spaces.find(i => i.id === id);
      if (space) {
        whimAPI.openCanvasWindow({ kind: 'space', id, title: space.description });
      }
    } : undefined,
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

// Listen for cross-window agent chat requests from canvas window
if (!isCanvasMode) {
  whimAPI.onOpenAgentChatInPanel((data) => {
    openAgentChat(data.agentId, data.agentPrompt, data.agentStatus, data.agentSource, data.spaceId);
  });
}

// ── Agent Presence Management ──────────────────────────
const canvasAgentPresence = new Map<string, DocumentPresence>();

function syncCanvasPresence(): void {
  updateCanvasPresence(Array.from(canvasAgentPresence.values()));
}

whimAPI.onAgentPresenceStarted((data) => {
  if (data.spaceId !== canvasSpaceId) return;
  canvasAgentPresence.set(data.agentId, {
    userId: data.persona.handle,
    color: data.persona.color,
    cursor: data.anchor?.prefix || data.anchor?.suffix ? data.anchor : undefined,
  });
  syncCanvasPresence();
});

whimAPI.onAgentPresenceEnded((data) => {
  if (!canvasAgentPresence.has(data.agentId)) return;
  canvasAgentPresence.delete(data.agentId);
  syncCanvasPresence();
});

whimAPI.onAgentReplyReady((data) => {
  if (data.spaceId !== canvasSpaceId) return;
  addCanvasCommentReply(data.threadIndex, data.body);
});

whimAPI.onCanvasContentUpdated((data) => {
  if (data.spaceId !== canvasSpaceId) return;
  replaceCanvasContent(data.content);
});

// ── Global agent status/approval listeners ─────────────
whimAPI.onAgentStatusChanged((data: any) => {
  if (currentFilter === 'agents') renderAgentsList();
  // Refresh Spaces view to update agent indicators
  if (currentFilter === 'open') loadSpaces();
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

whimAPI.onAgentApprovalNeeded((data: any) => {
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

whimAPI.onAgentCompleted(() => {
  if (currentFilter === 'agents') renderAgentsList();
  if (currentFilter === 'open') loadSpaces();
});

whimAPI.onAgentYoloChanged((data: { agentId: string; enabled: boolean }) => {
  agentYoloState.set(data.agentId, data.enabled);
  // Update the yolo button if visible
  const btn = document.querySelector(`.agent-card-yolo-btn[data-agent-id="${data.agentId}"]`) as HTMLElement | null;
  if (btn) {
    btn.classList.toggle('active', data.enabled);
    btn.title = data.enabled ? 'Yolo mode ON — click to disable' : 'Enable yolo mode (auto-approve all)';
  }
});

// ── Sandbox bubble-up handler ───────────────────────────
// Renders a stacked banner asking the user to allow once / for session /
// disable the sandbox. Lives at the top of <body>; multiple blocks stack.
const sandboxBlockContainer = (() => {
  const div = document.createElement('div');
  div.id = 'sandbox-block-stack';
  div.style.position = 'fixed';
  div.style.top = '12px';
  div.style.right = '12px';
  div.style.maxWidth = '380px';
  div.style.zIndex = '10000';
  div.style.display = 'flex';
  div.style.flexDirection = 'column';
  div.style.gap = '6px';
  document.body.appendChild(div);
  return div;
})();

function renderSandboxBlockBanner(data: {
  agentId: string;
  requestId: string;
  source: 'permission' | 'pre-tool' | 'post-tool-shell';
  kind: 'read' | 'write' | 'shell' | 'mcp' | 'url' | 'web-fetch';
  toolName?: string;
  target: string;
  intention?: string;
  allowedDecisions?: Array<'allow-once' | 'allow-for-session' | 'disable'>;
  layer?: 'host:readonly-classifier' | 'host:path-policy' | 'host:web-fetch' | 'host:permission' | 'mxc:shell-denial-suspected';
}): void {
  const banner = document.createElement('div');
  banner.className = 'sandbox-block-banner';

  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.textContent = data.source === 'post-tool-shell'
    ? `🔒 Possible sandbox denial`
    : `🔒 Sandbox blocked: ${data.kind}${data.toolName ? ` (${data.toolName})` : ''}`;
  banner.appendChild(title);

  // Show which enforcement layer fired so the user can verify whether MXC
  // actually denied (mxc:*) vs the host intercepted before MXC (host:*).
  if (data.layer) {
    const layerTag = document.createElement('div');
    layerTag.className = 'sandbox-block-banner-layer';
    layerTag.style.fontSize = '11px';
    layerTag.style.opacity = '0.75';
    layerTag.style.fontFamily = 'monospace';
    const layerLabel = data.layer.startsWith('mxc:')
      ? `Enforced by: MXC (${data.layer})`
      : `Enforced by: host (${data.layer})`;
    layerTag.textContent = layerLabel;
    banner.appendChild(layerTag);
  }

  const body = document.createElement('div');
  body.style.fontSize = '12px';
  body.style.lineHeight = '1.4';
  body.textContent = (data.intention ? `${data.intention}\n` : '') + `Target: ${data.target}`;
  body.style.whiteSpace = 'pre-wrap';
  banner.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'sandbox-block-banner-actions';

  const decisions: Array<'allow-once' | 'allow-for-session' | 'disable'> =
    data.allowedDecisions ?? ['allow-once', 'allow-for-session', 'disable'];
  const labels: Record<typeof decisions[number], string> = {
    'allow-once': 'Allow once',
    'allow-for-session': 'Allow for session',
    'disable': 'Disable sandbox',
  };
  for (const d of decisions) {
    const btn = document.createElement('button');
    btn.className = 'sandbox-block-banner-btn';
    btn.textContent = labels[d];
    btn.addEventListener('click', async () => {
      await whimAPI.resolveSandboxBlock(data.agentId, data.requestId, d);
      banner.remove();
    });
    actions.appendChild(btn);
  }

  if (data.source === 'post-tool-shell') {
    const ignoreBtn = document.createElement('button');
    ignoreBtn.className = 'sandbox-block-banner-btn';
    ignoreBtn.textContent = 'Ignore';
    ignoreBtn.addEventListener('click', async () => {
      // Soft signal — resolve as allow-once just to drain the broker callback.
      await whimAPI.resolveSandboxBlock(data.agentId, data.requestId, 'allow-once');
      banner.remove();
    });
    actions.appendChild(ignoreBtn);
  }

  banner.appendChild(actions);
  sandboxBlockContainer.appendChild(banner);
}

whimAPI.onAgentSandboxBlocked((data: any) => {
  renderSandboxBlockBanner(data);
});

// When the user clicks an OS notification, switch to Workers tab
whimAPI.onNotificationApprovalClicked(() => {
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
  } else if (canvasSpaceId) {
    whimAPI.closeCanvas(canvasSpaceId, content);
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

  // Arrow/Enter navigation in the space list
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
          openAgentChat(agent.agentId, agent.selectedText, agent.status, agent.source, agent.spaceId);
        }
        return;
      }
    } else {
      // Space list navigation
      if (e.key === 'ArrowDown' && selectedIndex >= 0) {
        e.preventDefault();
        if (selectedIndex < displayedSpaces.length - 1) {
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
      // Cmd+Enter: open canvas in a new window (even if one is already open)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const target = selectedIndex >= 0
          ? displayedSpaces[selectedIndex]
          : displayedSpaces[0];
        if (target) {
          whimAPI.openNewCanvasWindow({ kind: 'space', id: target.id, title: target.description });
        }
        return;
      }
      // Enter: open full editor for selected space
      if (e.key === 'Enter' && selectedIndex >= 0 && document.activeElement !== descInput) {
        e.preventDefault();
        const space = displayedSpaces[selectedIndex];
        if (space) openCanvas(space.id, true);
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

whimAPI.onWindowShown((data) => {
  selectedIndex = -1;
  searchResults = null;
  if (searchMode) exitSearchMode();
  // Always land on Spaces tab with focus in capture field
  setFilter('open');
  descInput.focus();
  descInput.select();
  hideStatus();
  // Refresh active session state when window reappears
  loadSpaces();

  // Slide in from the appropriate edge
  if (!data.expanded) {
    slideIn(data.side);
  } else {
    // Expanded mode: no slide, just make visible immediately
    appEl.classList.remove('app-hidden-left', 'app-hidden-right', 'app-no-transition');
    windowVisualState = 'visible';
  }
});

whimAPI.onWindowToggle(() => {
  // If on a sub-view, navigate back to the space list
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

whimAPI.onRequestHide(() => {
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
  welcomeWorkspaceHint.textContent = 'A folder where your spaces, skills, and agent data will live.';
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
  const savedCliPath = await whimAPI.getSetting('cli_path');
  welcomeCliPath.value = savedCliPath || '';

  // Auto-detect CLI and check version compatibility, then load models
  const cliOk = await checkWelcomeCli();
  if (cliOk) {
    loadWelcomeModels();
  } else {
    welcomeModelSelect.innerHTML = '<option value="">Waiting for valid CLI…</option>';
  }
}

async function loadWelcomeModels(retries = 5): Promise<void> {
  const models = await whimAPI.listModels();
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
  const saved = await whimAPI.getSetting('model');
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

function hideWelcomeView(): void {
  welcomeView.classList.add('hidden');
  mainView.classList.remove('hidden');
  descInput.focus();
}

async function checkWelcomeCli(): Promise<boolean> {
  welcomeCliStatus.textContent = 'Checking…';
  welcomeCliStatus.style.color = '';
  welcomeCliCheck.classList.add('hidden');
  welcomeStepCli.classList.remove('done');

  const info: { path: string | null; version: string | null; compatible: boolean; minVersion: string } =
    await whimAPI.checkCliVersion();

  if (!info.path) {
    welcomeCliStatus.textContent = 'Not found — install the Copilot CLI or provide a path below.';
    return false;
  } else if (!info.compatible) {
    const ver = info.version || 'unknown';
    welcomeCliStatus.textContent = `Version ${ver} found — update to ${info.minVersion}+ required (run: copilot update)`;
    welcomeCliStatus.style.color = 'var(--color-warning, #d29922)';
    return false;
  } else {
    const short = info.path.length > 40 ? '…' + info.path.slice(-38) : info.path;
    welcomeCliStatus.textContent = `Detected: ${short} (v${info.version})`;
    welcomeCliCheck.classList.remove('hidden');
    welcomeStepCli.classList.add('done');
    return true;
  }
}

// Save CLI path override from welcome screen input (save only, no re-check)
welcomeCliPath.addEventListener('change', async () => {
  const val = welcomeCliPath.value.trim();
  await whimAPI.setSetting('cli_path', val);
});

// Refresh button re-checks CLI after user upgrades or changes path
welcomeCliRefresh.addEventListener('click', async () => {
  const val = welcomeCliPath.value.trim();
  await whimAPI.setSetting('cli_path', val);
  const cliOk = await checkWelcomeCli();
  // Reload models since CLI may have changed
  welcomeModelSelect.innerHTML = '<option value="">Loading models…</option>';
  welcomeModelCheck.classList.add('hidden');
  welcomeStepModel.classList.remove('done');
  if (cliOk) {
    loadWelcomeModels();
  } else {
    welcomeModelSelect.innerHTML = '<option value="">Waiting for valid CLI…</option>';
  }
});

welcomeWorkspaceBtn.addEventListener('click', async () => {
  const result = await whimAPI.selectWorkspace();
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
    await whimAPI.setSetting('model', model);
  }

  hideWelcomeView();
  loadSpaces();
  loadSkills();
});

// ── Init ────────────────────────────────────────────────
// Check if workspace is set — show welcome or main view
whimAPI.getSetting('workspace_root').then(ws => {
  if (!ws && !isCanvasMode && !isSettingsMode) {
    showWelcomeView();
  } else if (!isSettingsMode) {
    loadSpaces();
  }
});

// Load personas in the main window so the @-mention dropdown on the Workers
// tab has data.  (Settings popout has its own loadPersonas() call.)
if (!isCanvasMode && !isSettingsMode) {
  loadPersonas().catch(() => { /* leaves personas[] empty */ });
}

// Refresh the space list when the canvas popout window is closed
whimAPI.onCanvasWindowClosed(() => {
  if (!isCanvasMode) loadSpaces();
});

// Listen for theme changes from other windows (e.g. settings popout)
if (!isCanvasMode && !isSettingsMode) {
  whimAPI.onCanvasThemeChanged((theme: string) => {
    applyTheme(theme);
  });
}

// Reload all data when workspace changes (select or clear)
whimAPI.onWorkspaceChanged((path: string | null) => {
  if (isCanvasMode || isSettingsMode) {
    // In canvas/settings window, close it — the workspace changed underneath
    window.close();
    return;
  }
  updateWorkspaceDisplay(path);
  hideSettings();
  if (path) {
    loadSpaces();
    loadSkills();
  } else {
    // Workspace cleared — show welcome view
    spaces = [];
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

  // ── Always-on-top toggle ────────────────────────────────
  async function toggleCanvasOnTop(): Promise<void> {
    const current = await whimAPI.getCanvasAlwaysOnTop();
    const next = !current;
    whimAPI.setCanvasAlwaysOnTop(next);
    canvasPinTopBtn.classList.toggle('active', next);
    canvasPinTopBtn.title = next ? 'Remove from top (⌘⇧T)' : 'Keep on top (⌘⇧T)';
  }

  canvasPinTopBtn.addEventListener('click', toggleCanvasOnTop);

  // Cmd+Shift+T keyboard shortcut
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
      e.preventDefault();
      toggleCanvasOnTop();
    }
  });

  // Sync initial state
  whimAPI.getCanvasAlwaysOnTop().then(pinned => {
    canvasPinTopBtn.classList.toggle('active', pinned);
    canvasPinTopBtn.title = pinned ? 'Remove from top (⌘⇧T)' : 'Keep on top (⌘⇧T)';
  });

  // Apply theme
  whimAPI.getSetting('theme').then(t => {
    if (t === 'dark') document.body.classList.add('dark');
  });

  // Listen for theme changes from main window
  whimAPI.onCanvasThemeChanged((theme: string) => {
    document.body.classList.toggle('dark', theme === 'dark');
  });

  // Save and unmount the current canvas target (space or skill)
  async function saveAndUnmountCurrent(): Promise<void> {
    const finalContent = getCanvasContent();
    await unmountCanvas();
    if (canvasSkillId) {
      await saveSkillFromCanvas(canvasSkillId, finalContent);
      canvasSkillId = null;
    } else if (canvasSpaceId) {
      await whimAPI.closeCanvas(canvasSpaceId, finalContent);
      canvasSpaceId = null;
    }
    canvasAgentPresence.clear();
  }

  // Listen for target to load (from main process)
  whimAPI.onLoadCanvasTarget(async (target: { kind: string; id: string; title: string }) => {
    // If a canvas is already open, save and close it first
    if (canvasSpaceId || canvasSkillId) {
      await saveAndUnmountCurrent();
    }

    if (target.kind === 'skill') {
      // Load skills list so openSkillEditor can find the skill
      cachedSkills = await whimAPI.listSkills();
      await openSkillEditor(target.id);
    } else {
      // Populate space data so openCanvas() can find it
      if (!spaces.find(i => i.id === target.id)) {
        spaces.push({
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
        const existing = spaces.find(i => i.id === target.id)!;
        existing.description = target.title;
      }

      await openCanvas(target.id);
    }
  });

  // Also load full spaces and skills in background for metadata
  whimAPI.list().then(list => { spaces = list; });
  whimAPI.listSkills().then(list => { cachedSkills = list; });
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
  whimAPI.getSetting('theme').then(t => {
    if (t === 'dark') document.body.classList.add('dark');
  });

  // Listen for theme changes from main window
  whimAPI.onCanvasThemeChanged((theme: string) => {
    document.body.classList.toggle('dark', theme === 'dark');
  });

  // Load settings data
  loadModels();
  loadWorkspaceSetting();
  loadThemeSetting();
  loadPersonas();
  loadRuntimes();
  loadCliPathSetting();
  loadMcpServers();
  loadCliTools();

  // Close button closes the window
  settingsClose.addEventListener('click', () => window.close());
}
