# MXC Sandbox Schema (as consumed by Intent)

This document describes the sandbox configuration schema used end-to-end:

1. The **MXC ContainerConfig** schema (the upstream JSON spec from
   `../mxc/docs/sandbox-policy/v1/policy.md` and `../mxc/docs/schema.md`).
2. The **runtime sandbox config** that `copilot-agent-runtime` reads from a
   per-session `configDir` and uses to spawn shell processes through
   `wxc-exec.exe`.
3. The **Intent `SandboxPolicy`** that the user edits in the Personas tab and
   that gets translated into a runtime config per agent.

> The full upstream schema lives at
> [`../../mxc/schemas/stable/mxc-config.schema.0.4.0-alpha.json`](../../mxc/schemas/stable/mxc-config.schema.0.4.0-alpha.json).
> This doc covers only the slice that Intent uses.

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

### Containment backends Intent uses

| Value | Notes |
|-------|-------|
| `"appcontainer"` | Default. Windows AppContainer process-level isolation via `wxc-exec.exe`. **Windows-only.** |

> Intent does not use `windows_sandbox`, `wslc`, `lxc`, `vm`, or `microvm` in v1.

### Versioning

MXC stable schema is `0.4.0-alpha`. Dev schema is `0.5.0-alpha`. Pre-release
suffixes signal that breaking changes can land in any release. Intent pins the
`0.4.0-alpha` version when materializing configs.

---

## 2. Runtime sandbox config (`copilot-agent-runtime`)

The runtime stores its own simplified slice in
`UserSettings.sandbox` (see
`../copilot-agent-runtime/src/core/persistence/userSettings.ts`):

```ts
sandbox?: {
  enabled?: boolean;
  filesystem?: {
    readwritePaths?: string[];
    readonlyPaths?:  string[];
    deniedPaths?:    string[];
    clearPolicyOnExit?: boolean;
  };
  network?: {
    allowOutbound?:     boolean;
    allowLocalNetwork?: boolean;
  };
}
```

Persisted as JSON under `${configDir}/config.json` (legacy) or
`${configDir}/settings.json` (new). When the SDK passes `configDir` to
`createSession` / `resumeSession`, the runtime treats `configDir` as
`COPILOT_HOME` and reads its config from there.

### How the runtime applies it

The runtime only consults `sandbox` for **shell** tool calls:

- `src/tools/interactiveShell.ts` (`if (config.sandbox?.enabled)` branch) calls
  `spawnSandboxedShell()` (`src/core/sandbox/sandboxSpawn.ts`).
- `spawnSandboxedShell` dynamically imports `@microsoft/mxc-sdk` and calls
  `sdk.spawnSandbox(script, { version: "0.4.0-alpha", filesystem: merged }, …)`,
  where `merged` is the user policy plus tool/profile/temp paths the SDK
  computes via `getAvailableToolsPolicy`, `getUserProfilePolicy`,
  `getTemporaryFilesPolicy`.

Tools like `view`, `edit`, `create`, `str_replace_editor`, `applyPatch`,
`glob`, `grep`, `show_file`, and `web_fetch` use Node `fs` / `fetch` directly
and **do not** consult `sandbox`. These have to be policed host-side by Intent.

### Important runtime quirks

- `clearPolicyOnExit`: defaults to true; tells the SDK to wipe AppContainer
  policies after the shell exits.
- `network.allowedHosts` is **NOT** part of the runtime's schema today, even
  though MXC supports it. Intent therefore drops `allowedHosts` from its v1
  policy.
- The runtime caches `UserSettings` keyed by `configDir`. Switching `configDir`
  on `resumeSession` is the supported way to swap policies; mutating
  `config.json` under the same `configDir` mid-session is not guaranteed to
  re-read.

---

## 3. Intent `SandboxPolicy`

The persona-level type Intent stores in its own `userData/config.json`:

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
}
```

This shape is intentionally smaller than the upstream MXC schema:

| Upstream MXC field | Intent representation | Why |
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
| `ui` | n/a | Intent's agents don't render UI inside the sandbox |

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

### How the policy materializes per agent

For each sandboxed agent launch, Intent writes **two** runtime-format configs:

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
- Intent flow doc: [`mxc-sandbox-flow.md`](./mxc-sandbox-flow.md)
