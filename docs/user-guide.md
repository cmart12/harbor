# Intent User Guide

This guide walks you through everything you can do with Intent — from first launch to deploying cloud agents.

---

## Getting Started

### First Launch

1. Install and start the app (`npm run start`)
2. Intent appears as a ⚡ icon in your system tray
3. Press **Ctrl+Shift+Space** (or **Cmd+Shift+Space** on Mac) to open the window
4. You'll be prompted to **select a workspace directory** — this is where all your intent data will be stored

### Setting Up Your Workspace

Your workspace is a regular directory (ideally a git repository) where Intent stores:
- Intent canvas documents as markdown files
- File attachments
- An event log and database cache

Click **⚙ Settings** → **Workspace** → **Change** to select your directory.

---

## Capturing Intents

### Typing

1. Press **Ctrl+Shift+Space** to open Intent
2. Start typing your thought, task, or goal
3. Press **Enter** to capture it

Intent uses AI to refine your input in the background — extracting a clean title, client names, and due dates. You'll see the refined text animate in with a subtle glow effect.

### Voice Input

1. Open Intent and make sure the text field is empty
2. Press **Spacebar** to start recording (you'll see a red recording indicator)
3. Speak naturally — describe your task in full sentences
4. Press **Spacebar** again to stop recording
5. Your speech is transcribed locally using Whisper (nothing leaves your machine)
6. The transcription is then refined by AI, just like typed input

### Smart Features

- **Query detection** — if you type a question instead of a task, Intent answers it inline
- **Recall** — when a new intent is similar to a past one, you'll see a hint linking them
- **Recurrence** — when you complete a recurring task (e.g., "weekly status update"), Intent automatically creates the next occurrence

---

## The Spaces Tab

The **Spaces** tab is your home view. It shows all active (non-completed) intents.

### Intent Cards

Each intent card shows:
- **Title** — the AI-refined description (hover to see ✨ refresh button)
- **Client badge** — extracted client/company name
- **Due date** — with overdue highlighting
- **Agent indicators** — mini-cards showing running agents with status:
  - ⚡ Running (green, animated)
  - ⏳ Needs attention (amber, pulsing)
  - ☁️ Cloud agent (blue)
  - ✓ Completed (grey)
  - ✗ Failed (red)

### Intent Actions

- **Click** an intent → opens its canvas
- **Click ✓ circle** → toggles completion status
- **Click ✨** → regenerates the title from canvas content using AI
- **Click ▶** → launches a terminal session
- **Click ✕** → deletes the intent
- **Click a mini-agent card** → opens that agent's chat directly

### Searching

Press **Shift+Tab** to enter search mode. Type to filter intents by description. Press **Shift+Tab** again or **Escape** to exit search.

---

## The Canvas Editor

The canvas is a rich markdown editor where you flesh out your intents.

### Opening the Canvas

- **Click** any intent → opens canvas in the tray window
- **Cmd+Enter** → opens canvas in expanded mode (larger window)
- When **pinned**, canvases open in a separate popout window

### Editing

The canvas supports:
- Headings, bold, italic, strikethrough
- Bullet and numbered lists
- Code blocks with syntax highlighting
- Links and images
- File attachments (paste or drag-drop)
- Comments and threads

### Saving

- **Auto-save** — changes are saved automatically after 2 seconds of inactivity
- **Cmd+S** — manual save
- All saves are auto-committed to git

### Version History

Click the **🕘** button in the canvas header to browse version history. You can see what changed in each commit and restore any previous version.

### Title Editing

Click the title in the canvas header to edit it. You can also click the **✨** button to auto-generate a title from the canvas content.

---

## AI Agents

Intent's agent system lets AI work on your documents and code autonomously.

### Deploying a Local Agent

1. Open an intent's canvas
2. Select text you want an agent to work on
3. Create a **comment** on the selected text (use the comment button in the editor)
4. Write instructions in the comment (e.g., "Fix the bug in this function")
5. **@mention a persona** (e.g., `@coder`) to specify which agent type
6. The agent starts working immediately

The agent:
- Reads your canvas document
- Executes tools (shell commands, file edits, web searches)
- Works autonomously until complete
- May request permission for certain operations

### Deploying a Cloud Agent

Cloud agents run on GitHub's infrastructure using the Copilot Coding Agent (CCA):

1. Go to **⚙ Settings** → **Agent Personas**
2. Create a persona (e.g., `@cca`) with **Run location: ☁️ Cloud**
3. Use that persona's @mention in a canvas comment
4. The agent runs in GitHub's cloud, creates a PR with its changes

Requirements for cloud agents:
- Your workspace must be a GitHub repository with a remote configured
- The `gh` CLI must be authenticated (`gh auth login`)
- The repository must have Copilot Coding Agent enabled

### Agent Status

Agents show their status in real-time:
- **⚡ Running** — actively working (animated pulse)
- **⏳ Waiting** — needs your approval for a permission
- **✓ Completed** — finished successfully
- **✗ Failed** — encountered an error

### Agent Chat

Click any agent (in Spaces mini-cards or Workers tab) to open the **chat view**:
- See the full conversation history
- Send follow-up messages
- View tool executions with details
- Approve or deny permission requests
- See sub-agent activity

### Approval Workflow

When an agent needs permission (e.g., to run a shell command), you'll see:
- An **amber badge** on the intent card ("⏳ needs attention")
- An **approval bar** in the Workers tab with Approve/Deny buttons
- A **notification** (OS-level) that you can click to jump to the agent

---

## The Workers Tab

The **Workers** tab shows all agents across all intents.

### Agent Cards

Each agent card shows:
- **Source icon** — ⚡ (local SDK), ☁️ (cloud), or 🖥 (CLI)
- **Intent name** — which intent the agent belongs to
- **Task description** — what the agent is working on
- **Live steps** — real-time tool execution progress
- **Summary** — completion summary or error message

### Worker Actions

- **Click a card** → opens the agent chat view
- **📄 button** (on hover) → opens the source canvas for the agent's intent
- **✕ button** (on hover) → deletes the agent session
- **Approve/Deny buttons** → respond to permission requests

---

## The Past Tab

The **Past** tab shows completed intents with their activity history, organized by completion date. Click any past intent to reopen its canvas.

---

## Settings

Open settings with the **⚙** button in the header.

### Theme
Toggle between **Light** ☀️ and **Dark** 🌙 themes.

### AI Model
Select which Copilot model to use for AI refinement and agent sessions.

### Workspace
Choose the directory where Intent stores all data.

### Copilot CLI
Auto-detected by default. Override with a custom path if needed.

### MCP Servers
Model Context Protocol servers extend what agents can do. Intent auto-discovers servers from `~/.copilot/mcp-config.json` and installed plugins. You can also add custom servers:
- **stdio** — command-line tool servers
- **http/sse** — web-based servers

### CLI Tools
Define CLI tools available in your environment (e.g., `gh`, `docker`, `kubectl`). Agents will know when to use these tools.

### Agent Personas
Create @mentionable personas:
- **Handle** — the @mention name (e.g., `coder`, `reviewer`, `cca`)
- **Instructions** — what the persona does and how it behaves
- **Model** — which AI model to use (or default)
- **Run location** — 💻 Local, ☁️ Cloud, or 🤖 Copilot Cloud Agent

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Toggle Intent window |
| `Enter` | Save intent / Open selected canvas |
| `Cmd+Enter` | Open canvas in expanded mode |
| `Escape` | Close current view / Dismiss window |
| `Space` (empty input) | Start/stop voice recording |
| `Shift+Tab` | Toggle search mode |
| `↑ / ↓` | Navigate intent/agent list |
| `← / →` | Switch between Spaces / Workers / Past tabs |
| `Cmd+S` | Save canvas |

---

## Window Behavior

### Edge Snapping
Drag the window to any screen edge and it snaps to position. Positions are remembered across sessions.

### Pin Mode
Click **📌** to pin the window:
- Window stays visible when you click outside
- Window becomes resizable
- Canvases open in separate popout windows (great for multi-monitor)

Unpin to return to auto-hide behavior.

### Expanded Mode
When you open a canvas (not pinned), the window expands to 720×700 centered on screen. Close the canvas to collapse back to tray size.

---

## Tips & Tricks

1. **Quick agent launch** — on the Workers tab, click **+ New Agent** to start an agent without a canvas
2. **Refresh titles** — hover any intent and click ✨ to auto-generate a better title from canvas content
3. **Jump to canvas from worker** — hover any worker card and click 📄 to open its source canvas
4. **Voice for long intents** — use voice input for lengthy descriptions; the AI will extract a clean title
5. **Git integration** — your workspace is auto-committed to git, so all changes are versioned
6. **Multiple agents** — deploy multiple agents on different sections of the same canvas; they work independently
