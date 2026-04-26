/**
 * Cross-platform window focus.
 * Consolidates focus logic from session.ts.
 */

import { execSync } from 'child_process';

export interface FocusOptions {
  /** Window title or session identifier to search for */
  title?: string;
  /** Process ID of the terminal to focus */
  pid?: number;
}

/**
 * Bring a terminal window to the foreground.
 * Returns true if focus was successful (or best-effort succeeded).
 */
export async function focusTerminalWindow(options: FocusOptions): Promise<boolean> {
  try {
    switch (process.platform) {
      case 'darwin':
        return focusMac(options);
      case 'win32':
        return focusWindows(options);
      default:
        return focusLinux(options);
    }
  } catch {
    return false;
  }
}

// ── macOS: AppleScript + Terminal.app ───────────────────

function focusMac(options: FocusOptions): boolean {
  // Build an AppleScript that tries to find a matching Terminal window,
  // falling back to simply activating Terminal.app.
  const matchExpr = options.title
    ? `name of w contains "${options.title.replace(/"/g, '\\"')}" or name of w contains "copilot"`
    : 'name of w contains "copilot"';

  const script = `
    tell application "Terminal"
      set found to false
      repeat with w in windows
        if ${matchExpr} then
          set index of w to 1
          set found to true
          exit repeat
        end if
      end repeat
      if found then
        activate
        return "True"
      else
        activate
        return "Fallback"
      end if
    end tell`;

  try {
    const result = execSync(`osascript -e '${script}'`, { timeout: 5_000 })
      .toString()
      .trim();
    return result === 'True' || result === 'Fallback';
  } catch {
    return false;
  }
}

// ── Windows: PowerShell AppActivate + process tree walk ─

function focusWindows(options: FocusOptions): boolean {
  if (!options.pid) return false;

  // When Windows Terminal is the default, cmd.exe runs inside a WT tab and the
  // PID itself has no window handle. Walk the process tree up to find the
  // hosting terminal (WindowsTerminal or conhost) and activate it.
  const script = `
    $found = (New-Object -ComObject WScript.Shell).AppActivate(${options.pid})
    if ($found) { Write-Output 'True'; exit }
    $hostPid = (Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -eq ${options.pid}
    }).ParentProcessId
    for ($i = 0; $i -lt 5; $i++) {
      $parent = Get-Process -Id $hostPid -ErrorAction SilentlyContinue
      if ($parent -and $parent.ProcessName -eq 'WindowsTerminal') {
        $found = (New-Object -ComObject WScript.Shell).AppActivate($hostPid)
        if ($found) { Write-Output 'True'; exit }
      }
      $next = (Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -eq $hostPid
      }).ParentProcessId
      if (-not $next -or $next -eq $hostPid) { break }
      $hostPid = $next
    }
    $wt = Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wt) {
      $found = (New-Object -ComObject WScript.Shell).AppActivate($wt.Id)
      if ($found) { Write-Output 'True'; exit }
    }
    Write-Output 'False'
  `.trim();

  try {
    const result = execSync(
      `powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: 5_000 },
    )
      .toString()
      .trim();
    return result === 'True';
  } catch {
    return false;
  }
}

// ── Linux: xdotool / wmctrl ────────────────────────────

function focusLinux(options: FocusOptions): boolean {
  if (!options.pid) return false;

  // Try xdotool first (most common)
  try {
    execSync(`xdotool search --pid ${options.pid} windowactivate`, {
      timeout: 3_000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    /* xdotool failed or not installed */
  }

  // Fallback to wmctrl
  try {
    execSync(
      `wmctrl -ia $(wmctrl -lp | grep ${options.pid} | head -1 | awk '{print $1}')`,
      { timeout: 3_000, stdio: 'ignore' },
    );
    return true;
  } catch {
    /* wmctrl failed or not installed */
  }

  return false;
}
