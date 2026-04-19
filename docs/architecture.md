# Architecture

Intent is an Electron app with a clear separation between the main process (Node.js) and the renderer process (Chromium).

## Main Process (`src/main/`)

### main.ts — App Lifecycle

- Creates a frameless, transparent, always-on-top `BrowserWindow`
- Registers a system tray icon with a context menu
- Binds `Ctrl+Shift+Space` as a global shortcut to toggle the window
- Registers a custom `copilot-intent://` protocol so the renderer has a real origin (required for microphone access)
- Positions the window near the bottom-right of the active display

### database.ts — Storage

- Uses `better-sqlite3` for synchronous, fast SQLite access
- **intents table**: stores captured intents with fields for the raw text, AI-refined description, extracted client/due date, and status (`captured`, `in_progress`, `done`)
- **settings table**: key-value store used for persisting the selected LLM model
- Includes a migration that adds `raw_text` column to existing databases

### ai.ts — Copilot SDK Integration

- Initializes a `CopilotClient` using TCP mode (`useStdio: false`) to avoid Electron child-process conflicts
- Creates a session with a system prompt that instructs the LLM to parse intents into structured JSON (`description`, `client`, `due_at`)
- Reads the stored model preference on startup and passes it to `createSession`
- Exposes:
  - `parseIntentWithAI(rawText)` — sends text to the LLM and extracts structured fields
  - `setAIModel(model)` — calls `session.setModel()` to switch models live
  - `listAvailableModels()` — delegates to `client.listModels()` for the settings dropdown

### ipc.ts — IPC Handlers

Bridges renderer requests to main-process logic:

| Channel | Direction | Purpose |
|---|---|---|
| `intent:create` | renderer → main | Stores intent, then kicks off background LLM processing |
| `intent:list` | renderer → main | Returns all intents ordered by creation date |
| `intent:update` | renderer → main | Updates intent fields (description, status, etc.) |
| `intent:delete` | renderer → main | Deletes an intent |
| `voice:transcribe` | renderer → main | Sends audio buffer to Whisper for transcription |
| `settings:get` | renderer → main | Reads a setting from the database |
| `settings:set` | renderer → main | Writes a setting; triggers `setAIModel` if key is `model` |
| `models:list` | renderer → main | Returns available models from the Copilot SDK |
| `intent:processed` | main → renderer | Notifies renderer that LLM refinement is complete |

**Background processing flow**: when `intent:create` is called, the intent is saved to SQLite immediately and returned to the renderer. A fire-and-forget async function then sends the raw text to the LLM, updates the intent in the database, and sends an `intent:processed` event back to the renderer.

### voice.ts — Local Speech-to-Text

- Uses `@huggingface/transformers` to run `onnx-community/whisper-tiny.en` locally
- Model is quantized to `q8` and cached in `%APPDATA%/intent/models/`
- Pre-loads the model on app startup so first transcription is fast
- Accepts a `Float32Array` of 16kHz mono audio and returns the transcribed text

### preload.ts — Context Bridge

Exposes the `intentAPI` object to the renderer via Electron's `contextBridge`. All IPC calls are wrapped in a typed API surface.

## Renderer Process (`src/renderer/`)

### index.html — Shell

Minimal HTML with:
- Header (title, badge, settings gear)
- Settings panel (model dropdown, hidden by default)
- Capture form (single text input with recording indicator)
- Intent list

### styles.css — Styling

Dark theme with:
- Translucent background with `backdrop-filter: blur`
- Recording state: red pulsing border + blinking dot indicator
- Transcribing state: indigo pulsing border
- Letter-glow animation for LLM refinement
- Fade-in animation for newly extracted metadata
- Smooth slide-in for new intent items

### app.ts — UI Logic

Key behaviors:

- **Auto-focus**: input is focused on window show and after each capture
- **Spacebar voice toggle**: when input is empty, spacebar starts MediaRecorder; spacebar again stops it. Audio is converted to 16kHz mono Float32Array and sent to the main process for Whisper transcription
- **Enter to capture**: form submit stores the intent and marks it as "processing"
- **LLM refinement animation**: when `intent:processed` fires, the old text is replaced letter-by-letter with the new text. Each new letter appears with an indigo glow that fades, creating a wave effect. Extracted client/due metadata fades in below
- **Settings panel**: gear icon toggles the panel; model dropdown is populated on open via `listModels()`
- **Escape handling**: closes settings if open, otherwise hides the window; stops recording if active

## Shared (`src/shared/`)

### types.ts

TypeScript interfaces shared between main and renderer:
- `Intent` — the intent data model
- `CreateIntentInput` — input for creating an intent
- `IpcChannels` — union type of all IPC channel names

## Data Flow

```
User types/speaks → Enter
       │
       ▼
  [Renderer] form submit
       │
       ├──► intentAPI.create({ description })
       │         │
       │         ▼
       │    [Main] createIntent() → SQLite INSERT
       │         │
       │         ├──► return intent to renderer (immediate)
       │         │
       │         └──► processIntentInBackground() (async)
       │                   │
       │                   ▼
       │              parseIntentWithAI(rawText)
       │                   │
       │                   ▼
       │              updateIntent(id, parsed fields)
       │                   │
       │                   ▼
       │              send 'intent:processed' → renderer
       │
       ▼
  [Renderer] adds to list with "refining..." badge
       │
       ▼
  [Renderer] onIntentProcessed → animateRefinement()
       │
       ▼
  Letter-glow animation replaces text, meta fades in
```
