import type { UpdateState } from '../shared/types';

/**
 * Pure state-transition helpers for the auto-updater. These contain the actual
 * "what should the user see" logic and have **no** dependency on Electron or
 * electron-updater, so they can be unit-tested directly. `update-service.ts`
 * owns the live state + broadcasting and delegates every transition here.
 *
 * `currentVersion` and `lastCheckedAt` are sticky across transitions (carried
 * via `...prev`) so every state the renderer receives can show them.
 */

export function startChecking(prev: UpdateState, initiatedBy: 'auto' | 'manual'): UpdateState {
  return { ...prev, status: 'checking', checkInitiatedBy: initiatedBy, error: undefined };
}

export function updateAvailable(
  prev: UpdateState,
  version: string | undefined,
  autoDownload: boolean,
  now: number = Date.now(),
): UpdateState {
  if (autoDownload) {
    return { ...prev, status: 'downloading', version, progress: 0, lastCheckedAt: now, error: undefined };
  }
  return { ...prev, status: 'available', version, lastCheckedAt: now, error: undefined };
}

export function updateNotAvailable(
  prev: UpdateState,
  initiatedBy: 'auto' | 'manual',
  now: number = Date.now(),
): UpdateState {
  // Surface a visible "up to date" confirmation only when the user asked; a
  // routine background poll quietly returns to idle so no banner ever appears.
  const status = initiatedBy === 'manual' ? 'up-to-date' : 'idle';
  return { ...prev, status, lastCheckedAt: now, version: undefined, progress: undefined, error: undefined };
}

export function downloadProgress(prev: UpdateState, percent: number | undefined): UpdateState {
  return { ...prev, status: 'downloading', progress: Math.round(percent ?? 0) };
}

export function updateDownloaded(prev: UpdateState, version: string | undefined): UpdateState {
  return { ...prev, status: 'downloaded', version, progress: 100, error: undefined };
}

export function updateError(prev: UpdateState, message: string, now: number = Date.now()): UpdateState {
  // Intentionally does NOT reset to idle: a swallowed error is exactly why
  // updates "never showed up". The error stays visible until the next check.
  return { ...prev, status: 'error', error: message, lastCheckedAt: now };
}
