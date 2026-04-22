# Architecture

Intent is an Electron app with a clear separation between the main process (Node.js) and the renderer process (Chromium). The renderer uses a hybrid approach: vanilla DOM for most views, with a React island for the Documint markdown editor.

## Main Process (`src/main/`)

### main.ts — App Lifecycle

- Creates a frameless, transparent, always-on-top `BrowserWindow` (420×520 default)
- Supports **window expand/collapse** — `Cmd+Enter` from the intent list expands to 720×700 centered; closing the canvas collapses back to tray size
- Registers a system tray icon with a context menu
- Binds `Ctrl+Shift+Space` as a global shortcut to toggle the window
- Registers a custom `copilot-intent://` protocol so the renderer has a real origin (required for microphone access and canvas image loading)
- Blur-hide logic: auto-hides on focus loss unless the canvas is open or input has content
- IPC handlers for `window:expand` and `window:collapse` animate window bounds

### database.ts — Storage

- Uses `better-sqlite3` for synchronous, fast SQLite access
- **intents table**: captured intents with raw text, AI-refined description, extracted client/due date, workspace folder, and status (`captured`, `in_progress`, `done`)
- **canvas_agents table**: agent records tracking SDK sessions launched from the canvas (`id`, `intent_id`, `selected_text`, `session_id`, `status`)
- **intent_events table**: cached event log entries for the timeline view
- Includes migrations for schema evolution

### ai.ts — Copilot SDK Client

- Initializes a `CopilotClient` using TCP mode (`useStdio: false`) to avoid Electron child-process conflicts
- Creates **three specialized sessions** with dedicated system prompts:
  - **Parse session** — extracts structured intent fields (title, client, due dates) from raw text
  - **Recurrence session** — evaluates whether completed intents should recur
  - **Recall session** — finds semantically similar past intents
- Exposes `getCopilotClient()` for the agent service to create additional sessions
- All sessions share the user's selected model via `setModel()`

### agent-service.ts — Canvas Agent Lifecycle

- Manages SDK-based agents launched from the canvas editor
- **`launchAgent()`**: creates a new `CopilotSession` with the intent's workspace as working directory, sends the user's instructions as a prompt with `canvas.md` as an attachment
- **Event streaming**: listens to `assistant.message`, `tool.execution_start/complete`, `session.idle`, `session.error`, and `permission.requested` events — forwards status updates to the renderer via IPC
- **Approval workflow**: `onPermissionRequest` handler pauses on permission requests, sends to renderer for approve/deny decision, then resumes
- **CLI attachment**: `openAgentCli()` launches `copilot --resume={sessionId}` in a terminal so the user can observe/steer the agent; the SDK session continues when the CLI disconnects
- In-memory agent Map tracks all active agents; persists to `canvas_agents` DB table

### workspace.ts — Workspace & Persistence

- Each intent gets a workspace subfolder (slug + 4-char ID suffix) assigned on first use
- Canvas content stored as `canvas.md`; attachments in `attachments/` subfolder
- **Event sourcing**: append-only `.intent/events.jsonl` is the source of truth; SQLite DB is a disposable cache rebuilt from the log on startup
- **Auto-commit**: debounced (2s) git commits for all workspace changes — `intent: auto-save {timestamp}`
- Attachment handling with 25MB max size, deduplication, and path traversal protection

### session.ts — Copilot CLI Management

- Discovers Copilot CLI binary across platform-specific paths
- `launchSession()` — opens a terminal with `copilot --resume={sessionId}` for interactive use
- `launchSessionInTerminal()` — exported for agent CLI attachment
- Platform-specific terminal launchers (macOS Terminal via AppleScript, Windows PowerShell, Linux gnome-terminal/xterm)
- Process liveness detection and window focus management

### ipc.ts — IPC Handlers

Bridges renderer requests to main-process logic:

| Channel | Direction | Purpose |
|---|---|---|
| `intent:create` | renderer → main | Stores intent, kicks off background LLM processing |
| `intent:list` | renderer → main | Returns all intents |
| `intent:update` | renderer → main | Updates intent fields |
| `intent:delete` | renderer → main | Deletes an intent |
| `canvas:read` | renderer → main | Load canvas.md content |
| `canvas:write` | renderer → main | Save canvas.md content |
| `canvas:close` | renderer → main | Save + trigger git auto-commit |
| `canvas:paste-file` | renderer → main | Save pasted/dropped file to attachments/ |
| `agent:launch` | renderer → main | Deploy SDK agent with instructions + anchor |
| `agent:list` | renderer → main | List agents for an intent |
| `agent:approve` | renderer → main | Respond to agent permission request |
| `agent:abort` | renderer → main | Abort a running agent |
| `agent:open-cli` | renderer → main | Open terminal attached to agent session |
| `agent:status-changed` | main → renderer | Agent status update notification |
| `agent:approval-needed` | main → renderer | Permission request from agent |
| `agent:completed` | main → renderer | Agent finished notification |
| `intent:processed` | main → renderer | LLM refinement complete |
| `window:expand` | renderer → main | Expand window to full editor size |
| `window:collapse` | renderer → main | Collapse window to tray size |

### voice.ts — Local Speech-to-Text

- Uses `@huggingface/transformers` to run `onnx-community/whisper-tiny.en` locally
- Model is quantized to `q8` and cached in user data directory
- Pre-loads the model on app startup so first transcription is fast

### config.ts — User Configuration

- Stores theme (`light`/`dark`), selected model, and per-intent session IDs
- Persisted at `<userData>/config.json` (separate from workspace)

### preload.ts — Context Bridge

Exposes the `intentAPI` object to the renderer via Electron's `contextBridge`. Includes all IPC invoke channels, push notification listeners, and window control methods.

## Renderer Process (`src/renderer/`)

### Build System

The renderer is bundled by **esbuild** (not tsc) to support React JSX and ESM imports from the Documint package. Output is a single IIFE bundle at `dist/renderer/app.js`. React and Documint are aliased to prevent duplicate instances.

### index.html — Shell

Four views managed via CSS class toggling:

1. **Main view** — intent capture form, filter bar (All | Scheduled | Open | Past | ⚡ Agents), intent list
2. **Settings view** — theme toggle, model picker, workspace selector
3. **Timeline view** — event activity log
4. **Canvas view** — header (back, title, save, session launch) + `#canvas-root` container for the React editor

### styles.css — Styling

Light and dark themes with:
- Translucent background with `backdrop-filter: blur`
- Recording/transcribing state animations
- Letter-glow animation for LLM refinement
- Agent list item styles with status-based pulsing
- Agent launch bar and approval bar overlays
- Canvas container sizing (absolute positioning for Documint)

### app.ts — UI Logic

Key behaviors:
- **Filter bar**: All, Scheduled, Open, Past, and **⚡ Agents** tabs. The Agents tab renders a cross-intent agent list showing status, selected text, parent intent, and summary
- **Canvas mounting**: `openCanvas(id, expanded?)` loads content and mounts the React Documint editor; `closeCanvas()` flushes saves, unmounts, and collapses window if expanded
- **Keyboard navigation**: Arrow keys navigate intents, Enter opens canvas, `Cmd+Enter` expands + opens canvas, Escape closes views
- **`beforeunload`**: flushes canvas saves on app quit

### canvas/DocumintCanvas.tsx — Documint Wrapper

The React component that bridges Documint to Intent's IPC layer:

- **Content management**: controlled component with equality guards to prevent normalization churn
- **Save contract**: debounced auto-save (2s) + `saveNow()` via `useImperativeHandle` for flush-on-close
- **File attachments**: capture-phase paste/drop handlers intercept before Documint's hidden textarea
- **Agent deployment**: watches for new comment threads in `onContentChange` → shows "Run Agent" bar → launches SDK agent with the comment body as instructions and the highlighted text as context
- **Agent decoration**: running agents rendered as Documint `CommentThread` objects (underline on anchored text). Flash animation via `setInterval` toggling `resolvedAt`. Completed agents shown as resolved threads.
- **Double-click → CLI**: detects double-click on agent-decorated text, opens `copilot --resume` in terminal
- **Approval overlay**: floating bar for agent permission requests (approve/deny)
- **Theme mapping**: Intent light/dark → Documint lightTheme/darkTheme

### canvas/mount.tsx — React Root Lifecycle

Manages the React root for the canvas island:
- `mountCanvas(container, options)` — creates root, renders DocumintCanvas
- `unmountCanvas()` — flushes pending saves, unmounts root
- `getCanvasContent()` — returns current content for close/commit

## Shared (`src/shared/types.ts`)

TypeScript interfaces shared between main and renderer:
- `Intent` — the full intent data model with workspace folder, attachments, recurrence
- `CanvasAgent` — agent record (`running` | `waiting-approval` | `completed` | `failed`)
- `AgentAnchor` — text anchor for agent decoration (quote + prefix/suffix)
- `Attachment`, `RecurrenceResult`, `RecallMatch`, `CreateIntentInput`

## Data Flow

### Intent Capture
```
User types/speaks → Enter
       │
       ▼
  [Renderer] form submit → intentAPI.create()
       │
       ├──► [Main] createIntent() → SQLite + event log
       │         │
       │         ├──► return intent immediately
       │         └──► processIntentInBackground() (async)
       │                   ├── parseIntentWithAI() → refined description
       │                   ├── evaluateRecurrence() (if completed + dated)
       │                   └── findSimilarIntent() → recall hint
       │
       ▼
  [Renderer] letter-glow animation + metadata fade-in
```

### Agent Deployment
```
User selects text in canvas → creates comment with instructions
       │
       ▼
  [Renderer] detects new comment thread → shows "Run Agent" bar
       │
       ▼
  User clicks "Run Agent"
       │
       ▼
  [Renderer] intentAPI.launchAgent(intentId, instructions, anchor)
       │
       ▼
  [Main] agent-service.launchAgent()
       ├── client.createSession({ workingDir, systemMessage })
       ├── session.send({ prompt, attachments: [canvas.md] })
       └── session.on('*') → forward events to renderer
       │
       ▼
  [Renderer] shows flashing underline on selected text
  [Renderer] approval bar if permission.requested
  [Renderer] double-click → copilot --resume={sessionId} in terminal
  [Renderer] completed → resolved underline
```
