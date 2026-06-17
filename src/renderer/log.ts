/**
 * Renderer-side log helper that forwards messages to the main process
 * via the `log:from-renderer` IPC channel, so they land in the
 * debug-tap file at ~/.copilot/sessions-output/harbor-debug.log.
 *
 * Also calls the original console method so DevTools output is preserved.
 */

declare const whimAPI: { logToMain(level: 'info' | 'warn' | 'error', message: string): void };

function stringify(...args: unknown[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

export function logToMain(level: 'info' | 'warn' | 'error', ...args: unknown[]): void {
  const message = stringify(...args);

  // Keep DevTools output intact.
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);

  // Forward to main process file log.
  try {
    whimAPI.logToMain(level, message);
  } catch {
    // Preload not ready or test environment; swallow silently.
  }
}
