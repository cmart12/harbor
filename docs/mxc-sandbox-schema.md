# MXC Sandbox Schema (as consumed by whim)

This document describes the sandbox configuration schema used end-to-end:

1. The **MXC ContainerConfig** schema (the upstream JSON spec from
   `../mxc/docs/sandbox-policy/v1/policy.md` and `../mxc/docs/schema.md`).
2. The **runtime sandbox config** that `copilot-agent-runtime` reads from a
   per-session `configDir` and uses to spawn shell processes through
   `wxc-exec.exe`.
3. The **whim `SandboxPolicy`** that the user edits in the Personas tab and
   that gets translated into a runtime config per agent.

> The full upstream schema lives at
> [`../../mxc/schemas/stable/mxc-config.schema.0.4.0-alpha.json`](../../mxc/schemas/stable/mxc-config.schema.0.4.0-alpha.json).
> This doc covers only the slice that whim uses.

---

## 1. MXC ContainerConfig (upstream)

The MXC SDK accepts a JSON config like this (Windows AppContainer example):

```jsonc
{
  "version": "0.4.0-alpha",            // semver of the schema
  "containerId": "intent-<agentId>",   // arbitrary identifier
  "containment": "appcontainer",       // backend; we use "appcontainer"

  "lifecycle": {
    "destroyOnExit": true,
    "preservePolicy": false
  },

  "process": {
    "commandLine": "powershell.exe …", // wrapped command
    "cwd": "C:\\workspace\\<intent>",  // intent folder
    "env": ["MY_VAR=value"],
    "timeout": 30000
  },

  "filesystem": {
    "readwritePaths": ["C:\\workspace\\<intent>"],
    "readonlyPaths":  [],
    "deniedPaths":    []
  },

  "network": {
    "defaultPolicy":   "block",     // "allow" | "block"
    "enforcementMode": "firewall",  // "capabilities" | "firewall" | "both"
    "allowedHosts":    [],
    "blockedHosts":    [],
    "proxy":           null
  },

  "appContainer": {
    "leastPrivilege": true,
    "capabilities":   []  // e.g. ["internetClient"] when network is allowed
  }
}
```

### Containment backends whim uses

| Value | Notes |
|-------|-------|
| `"appcontainer"` | Default. Windows AppContainer process-level isolation via `wxc-exec.exe`. **Windows-only.** |

> whim does not use `windows_sandbox`, `wslc`, `lxc`, `vm`, or `microvm` in v1.

### Versioning

MXC stable schema is `0.4.0-alpha`. Dev schema is `0.5.0-alpha`. Pre-release
suffixes signal that breaking changes can land in any release. whim pins the
`0.4.0-alpha` version when materializing configs.

---

## 2. Runtime sandbox config (`copilot-agent-runtime`)

The runtime stores its own simplified slice in `UserSettings.sandbox` (see
`../copilot-agent-runtime/src/core/persistence/userSettings.ts` for the
authoritative zod schema and `src/core/sandbox/index.ts` for the resolved-view
loader):

```ts
sandbox?: {
  enabled?: boolean;
  /**
   * User-managed sandbox policy fragment. The runtime reads policy from
   * `userPolicy.{filesystem,network,experimental}` — not directly from
   * `sandbox.{filesystem,network}`. Writing the flat shape (without
   * `userPolicy`) means the runtime silently falls back to defaults
   * (notably `allowOutbound: true`).
   */
  userPolicy?: {
    filesystem?: {
      readwritePaths?: string[];
      readonlyPaths?:  string[];
      deniedPaths?:    string[];
      clearPolicyOnExit?: boolean;
    };
    network?: {
      allowOutbound?:     boolean;
      allowLocalNetwork?: boolean;
      allowedHosts?:      string[];
      blockedHosts?:      string[];
    };
    experimental?: {
      seatbelt?: { keychainAccess?: boolean };
    };
  };
  /** Raw ContainerConfig passthrough — takes precedence over userPolicy. */
  config?: Record<string, unknown>;
  /** Auto-add cwd to readwritePaths. Default: true. */
  addCurrentWorkingDirectory?: boolean;
};
```

Persisted as JSON under `${configDir}/config.json` (legacy) or
`${configDir}/settings.json` (new). When the SDK passes `configDir` to
`createSession` / `resumeSession`, the runtime treats `configDir` as
`COPILOT_HOME` and reads its config from there.

### How the runtime applies it

The runtime only consults `sandbox` for **shell** tool calls:

- `src/tools/interactiveShell.ts` (`if (config.sandbox?.enabled)` branch) calls
  `spawnSandboxedShell()` (`src/core/sandbox/sandboxSpawn.ts`).
- `spawnSandboxedShell` reads `userPolicy.filesystem` and `userPolicy.network`,
  merges them with auto-discovered tool/profile/temp paths, then dynamically
  imports `@microsoft/mxc-sdk` and calls `sdk.spawnSandbox(...)`.

Tools like `view`, `edit`, `create`, `str_replace_editor`, `applyPatch`,
`glob`, `grep`, `show_file`, and `web_fetch` use Node `fs` / `fetch` directly
and **do not** consult `sandbox`. These have to be policed host-side by Whim
(or skipped entirely under `enforcementMode: 'mxc-only'`).

### Important runtime quirks

- `clearPolicyOnExit`: defaults to true; tells the SDK to wipe AppContainer
  policies after the shell exits.
- `network.allowedHosts` is exposed by the runtime schema but **not used by
  the macOS Seatbelt backend** (Seatbelt cannot filter per-host). On darwin,
  only `allowOutbound: false` actually restricts network traffic. Whim's
  v1 policy therefore omits `allowedHosts`.
- The runtime caches `UserSettings` keyed by `configDir`. Switching `configDir`
  on `resumeSession` is the supported way to swap policies; mutating
  `config.json` under the same `configDir` mid-session is not guaranteed to
  re-read.
- **Wrong shape = silent no-op.** If Whim writes `sandbox.filesystem`
  directly instead of `sandbox.userPolicy.filesystem`, the runtime's zod
  schema accepts the file (passthrough) but the policy loader sees
  `userPolicy` as undefined and falls back to defaults. There is no error.

---

## 3. whim `SandboxPolicy`

The persona-level type whim stores in its own `userData/config.json`:

```ts
export interface SandboxPolicy {
  // Filesystem
  scopeToIntentFolder: boolean;      // implicit RW for the intent folder (default true)
  extraReadwritePaths: string[];
  extraReadonlyPaths:  string[];
  extraDeniedPaths:    string[];

  // Tool surface (host-side enforcement; not in MXC)
  allowMcpServers: boolean;          // default false: hide MCP from sandboxed agents
  allowWebFetch:   boolean;          // default false: drop web_fetch custom tool

  // Network (passed straight through to the runtime; affects shell child only)
  allowOutbound:     boolean;        // default false
  allowLocalNetwork: boolean;        // default false

  // Enforcement layers — see "enforcementMode field" below.
  enforcementMode: 'both' | 'mxc-only'; // default 'both'
}
```

This shape is intentionally smaller than the upstream MXC schema:

| Upstream MXC field | whim representation | Why |
|---|---|---|
| `version` | hardcoded to `0.4.0-alpha` | runtime + intent pin one version |
| `containment` | hardcoded to `"appcontainer"` | only Windows backend in v1 |
| `containerId` | derived from `agentId` | per-agent isolation |
| `process.cwd` | derived from intent folder | intent always sets this |
| `lifecycle` | runtime defaults | not user-tunable in v1 |
| `filesystem.readwritePaths` | `[intentFolder, ...extraReadwritePaths]` | `scopeToIntentFolder` adds the intent folder |
| `filesystem.readonlyPaths` | `extraReadonlyPaths` | dropped the workspace-root default |
| `filesystem.deniedPaths` | `extraDeniedPaths` | direct mapping |
| `network.defaultPolicy` | `allowOutbound ? "allow" : "block"` | derived |
| `network.allowedHosts` | **not exposed** | runtime doesn't read it today |
| `appContainer.capabilities` | `["internetClient"]` if `allowOutbound` | derived |
| `ui` | n/a | whim's agents don't render UI inside the sandbox |

### Resolution: default policy + per-persona override

```ts
function resolveSandboxPolicy(persona: AgentPersona): SandboxPolicy {
  return persona.sandboxPolicyOverride ?? config.sandboxDefaultPolicy;
}
```

- `AppConfig.sandboxDefaultPolicy` — the global default editable on the Personas tab.
- `AgentPersona.sandboxPolicyOverride` — optional override on a single persona.

A persona triggers the sandbox path **only when** `persona.sandboxed === true`
**and** `IS_WINDOWS`. Without `sandboxed`, the agent launches with no `configDir`
and the full tool surface — same as today.

### `enforcementMode` field

```ts
enforcementMode: 'both' | 'mxc-only';
```

- `'both'` (default): host-side guards run on top of MXC. Most denials are
  caught host-side and never reach MXC. The agent receives a
  `[SANDBOX MODE] You are running in a sandboxed environment …` fragment in
  its system prompt so it self-restricts on top of the host-side guards.
  `onPermissionRequest` uses `createPathAwareSandboxPermissionHandler`,
  which auto-approves in-scope reads/writes and bubbles up out-of-scope
  ones via `agent:sandbox-blocked`.
- `'mxc-only'`: host-side guards are suppressed at launch — `onPreToolUse`
  is not installed and `onPermissionRequest` uses
  `createMxcOnlyPermissionHandler`, an auto-approve handler that lets every
  SDK permission kind through (logged with the `mxc-only:auto-approve` layer
  tag for traceability). The `[SANDBOX MODE]` system-prompt fragment is
  **also omitted**, so the agent has no awareness that a sandbox exists —
  that's necessary to observe MXC's own denials (an agent told it's
  sandboxed, or asked for permission for every write, will avoid the very
  calls we want MXC to deny). MXC's AppContainer + network firewall is the
  sole enforcer for shell tools — actual denials surface via the post-tool
  detector (`mxc:shell-denial-suspected`). Path-bearing SDK tools
  (view/edit/create/glob/grep) are **not** seen by MXC and become
  unrestricted in this mode (auto-approve → call succeeds). Intended only
  for verifying MXC enforcement;
  see [`mxc-sandbox-flow.md`](./mxc-sandbox-flow.md#how-to-verify-mxc-is-actually-doing-the-enforcement).

The validator (`src/main/validators.ts`) clamps unrecognized values to
`'both'` so existing on-disk personas that pre-date the field keep working.

### Sandbox layer taxonomy

Every host-side denial and detected MXC denial is tagged with a
`SandboxLayer` value (defined in `src/shared/ipc-contract.ts`). The tag is
logged via `logSandboxLayerDenial(...)` in `src/main/agents/sandbox-policies.ts`
and forwarded to the renderer in `agent:sandbox-blocked.layer` so the
bubble-up banner can show *which* layer fired:

| Tag | Source | Fires for |
|---|---|---|
| `host:readonly-classifier` | `createSandboxPathPolicyHook` (defense-in-depth shell branch) | Non-read-only shell command in `both` mode |
| `host:path-policy` | `createSandboxPathPolicyHook` (path-bearing tools branch) | view/edit/create/glob/grep/show_file/str_replace_editor outside policy paths |
| `host:web-fetch` | `createSandboxPathPolicyHook` | `web_fetch` URL with `allowWebFetch=false` |
| `host:permission` | `createPathAwareSandboxPermissionHandler` | Runtime `read`/`write`/`mcp`/`url` permission requests outside policy |
| `mxc:shell-denial-suspected` | `createSandboxShellDenialHook` (heuristic post-tool) | Shell output matched MXC denial patterns (`Access is denied.`, `0xC0000022`, `wxc-exec`, etc.) |

### How the policy materializes per agent

For each sandboxed agent launch, whim writes **two** runtime-format configs:

```
${userData}/sandbox-config/<agentId>/on/config.json    // sandbox.enabled = true
${userData}/sandbox-config/<agentId>/off/config.json   // sandbox.enabled = false
```

Both are passed-by-path to `client.createSession` / `client.resumeSession`. The
"off" config is materialized eagerly so the bubble-up "Disable sandbox" path
can `resumeSession` into it instantly.

---

## 4. References

- Upstream MXC policy spec: `../../mxc/docs/sandbox-policy/v1/policy.md`
- Upstream MXC config schema: `../../mxc/docs/schema.md`
- Runtime sandbox config schema:
  `../../copilot-agent-runtime/src/core/persistence/userSettings.ts` (`sandbox` block)
- Runtime shell wrapper:
  `../../copilot-agent-runtime/src/core/sandbox/sandboxSpawn.ts`
- whim flow doc: [`mxc-sandbox-flow.md`](./mxc-sandbox-flow.md)
