# Intent

A lightweight Electron system-tray app for capturing intents — quick thoughts, tasks, and to-dos — with voice input and AI-powered refinement.

## Overview

Intent lives in your system tray and pops up with `Ctrl+Shift+Space`. Type or speak what you need to do, press Enter, and it's captured instantly. In the background, an LLM refines your raw input — cleaning up the description and extracting structured fields like client names and due dates.

### Key Features

- **Quick capture** — global hotkey (`Ctrl+Shift+Space`) summons a floating window; press Enter to save
- **Voice input** — press spacebar when the input is empty to start recording; press spacebar again to stop. Transcription runs locally via Whisper (no cloud dependency)
- **Passive AI refinement** — every captured intent is sent to GitHub Copilot's LLM in the background. The refined text animates in with a letter-glow effect
- **System tray** — the app runs in the tray and stays out of your way
- **Settings** — gear icon opens a model picker populated from the Copilot SDK

## Architecture

```
src/
├── main/           # Electron main process
│   ├── main.ts     # App lifecycle, tray, window, global shortcut
│   ├── database.ts # SQLite via better-sqlite3 (intents + settings)
│   ├── ai.ts       # Copilot SDK integration (LLM parsing)
│   ├── ipc.ts      # IPC handlers bridging renderer ↔ main
│   ├── voice.ts    # Local Whisper model (speech-to-text)
│   └── preload.ts  # Context bridge exposing intentAPI to renderer
├── renderer/       # Electron renderer process
│   ├── index.html  # App shell
│   ├── styles.css  # Dark-theme UI styles
│   └── app.ts      # UI logic, recording, animations
└── shared/
    └── types.ts    # Shared TypeScript types
```

See [architecture.md](./architecture.md) for detailed component descriptions.

## Getting Started

### Prerequisites

- Node.js 20+
- GitHub Copilot CLI (for AI features) — `npm install -g @anthropic-ai/copilot` or via `gh`
- A GitHub account with Copilot access

### Install & Run

```bash
npm install
npm run start
```

The app will build, launch, and appear in your system tray. Press `Ctrl+Shift+Space` to open.

### Development

```bash
npm run dev    # Same as start — builds then launches Electron
```

## Usage

| Action | How |
|---|---|
| Open window | `Ctrl+Shift+Space` or click tray icon |
| Type an intent | Just start typing |
| Voice input | Press `Space` when input is empty → speak → press `Space` to stop |
| Save | Press `Enter` |
| Toggle done | Click the circle next to an intent |
| Delete | Hover an intent and click ✕ |
| Change model | Click ⚙ in the header |
| Dismiss window | `Escape` or click outside |

## Database

SQLite database stored at `%APPDATA%/intent/intents.db` with two tables:

- **intents** — `id`, `description`, `raw_text`, `client`, `due_at`, `status`, `created_at`, `updated_at`
- **settings** — key-value store for app configuration (e.g., `model`)

## License

ISC
