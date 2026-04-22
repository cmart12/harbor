# Intent

A lightweight Electron system-tray app for capturing intents — quick thoughts, tasks, and to-dos — with voice input, AI-powered refinement, and an integrated markdown canvas with agent deployment.

## Overview

Intent lives in your system tray and pops up with `Ctrl+Shift+Space`. Type or speak what you need to do, press Enter, and it's captured instantly. In the background, an LLM refines your raw input — cleaning up the description and extracting structured fields like client names and due dates.

Each intent has a **canvas** — a full markdown editor (powered by [Documint](https://github.com/lostintangent/documint)) where you can flesh out notes, paste files, and deploy AI agents to work on specific sections of your document.

### Key Features

- **Quick capture** — global hotkey (`Ctrl+Shift+Space`) summons a floating window; press Enter to save
- **Voice input** — press spacebar when the input is empty to start recording; press spacebar again to stop. Transcription runs locally via Whisper (no cloud dependency)
- **Passive AI refinement** — every captured intent is sent to GitHub Copilot's LLM in the background. The refined text animates in with a letter-glow effect
- **Markdown canvas** — click any intent to open its canvas in the tray window; press `Cmd+Enter` to expand to a larger floating editor. Canvas content is stored as `canvas.md` in workspace folders and auto-committed to git
- **Agent deployment** — highlight text in the canvas, create a comment with instructions, and click "Run Agent" to deploy a Copilot SDK agent. The agent works autonomously; double-click the highlighted text to attach a CLI for live steering
- **Agents tab** — see all running agents across all intents from the main view
- **File attachments** — paste or drag-drop files into the canvas; images and documents are stored in `attachments/` subfolders
- **Smart recurrence** — dated intents are re-evaluated on completion; recurring tasks automatically spawn the next occurrence
- **Recall** — new intents are matched against past intents for semantic similarity hints
- **System tray** — the app runs in the tray and stays out of your way

## Architecture

```
src/
├── main/                  # Electron main process
│   ├── main.ts            # App lifecycle, tray, window, expand/collapse
│   ├── database.ts        # SQLite (intents, canvas_agents, events)
│   ├── ai.ts              # Copilot SDK client (parse, recurrence, recall sessions)
│   ├── agent-service.ts   # SDK-based canvas agent lifecycle management
│   ├── ipc.ts             # IPC handlers bridging renderer ↔ main
│   ├── workspace.ts       # Workspace folders, canvas I/O, git auto-commit
│   ├── eventlog.ts        # Append-only event log (.intent/events.jsonl)
│   ├── session.ts         # Copilot CLI discovery, terminal launch
│   ├── voice.ts           # Local Whisper model (speech-to-text)
│   ├── config.ts          # User config (theme, model, sessions)
│   └── preload.ts         # Context bridge exposing intentAPI
├── renderer/              # Electron renderer process
│   ├── index.html         # App shell (main, settings, timeline, canvas views)
│   ├── styles.css         # Light/dark theme styles
│   ├── app.ts             # UI logic, filters, navigation, canvas mounting
│   └── canvas/            # React island for the markdown editor
│       ├── DocumintCanvas.tsx  # Documint wrapper with save, agents, attachments
│       └── mount.tsx          # React root lifecycle (mount/unmount)
├── shared/
│   └── types.ts           # Shared TypeScript types
└── assets/
    └── tray-icon.png      # System tray icon
```

**Build system:**
- Main process: `tsc` via `tsconfig.main.json`
- Renderer: `esbuild` bundles React + Documint + app code into a single IIFE
- Assets: HTML and CSS copied to `dist/renderer/`

See [architecture.md](./architecture.md) for detailed component descriptions.

## Getting Started

### Prerequisites

- Node.js 20+
- [Bun](https://bun.sh) (to build the Documint editor from `../documint`)
- GitHub Copilot CLI — `npm install -g @github/copilot`
- A GitHub account with Copilot access

### Install & Run

```bash
# Build the Documint editor (one-time, from sibling directory)
cd ../documint && bun install && bun run package && cd -

# Install and start
npm install
npm run start
```

The app will build, launch, and appear in your system tray. Press `Ctrl+Shift+Space` to open.

### Development

```bash
npm run dev    # Builds then launches with tsc watch + esbuild watch + Electron
```

## Usage

| Action | How |
|---|---|
| Open window | `Ctrl+Shift+Space` or click tray icon |
| Type an intent | Just start typing |
| Voice input | Press `Space` when input is empty → speak → press `Space` to stop |
| Save | Press `Enter` |
| Search intents | Press `Shift+Tab` to toggle search mode |
| Open canvas (small) | Click an intent |
| Open canvas (expanded) | `Cmd+Enter` from the intent list |
| Save canvas | `Cmd+S` in the editor |
| Deploy an agent | Select text → click comment button → write instructions → click "Run Agent" |
| Watch agent in CLI | Double-click the agent-underlined text |
| View all agents | Click the "⚡ Agents" filter tab |
| Toggle done | Click the circle next to an intent |
| Delete | Hover an intent and click ✕ |
| Change model | Click ⚙ in the header |
| Dismiss window | `Escape` or click outside |

## Workspace

Intent stores data in a user-selected workspace directory:

```
<workspace>/
├── .intent/
│   ├── events.jsonl       # Append-only event log (source of truth)
│   └── intents.db         # SQLite cache (rebuilt from event log)
├── <intent-slug-a1b2>/
│   ├── canvas.md          # Markdown canvas content
│   └── attachments/       # Pasted/dropped files
└── .gitignore
```

All workspace changes are auto-committed to git with `intent: auto-save` messages.

## Database

SQLite database at `<workspace>/.intent/intents.db`:

- **intents** — `id`, `description`, `raw_text`, `body`, `client`, `due_at`, `due_at_utc`, `recurrence`, `completed_at`, `folder`, `session_id`, `attachments`, `status`, `created_at`, `updated_at`
- **canvas_agents** — `id`, `intent_id`, `selected_text`, `session_id`, `pid`, `status`, `created_at`, `updated_at`
- **intent_events** — event sourcing log cache

User config (theme, model, session IDs) stored separately at `<userData>/config.json`.

## License

ISC
