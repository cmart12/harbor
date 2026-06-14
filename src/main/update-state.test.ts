import { describe, it, expect } from 'vitest';
import type { UpdateState } from '../shared/types';
import {
  startChecking,
  updateAvailable,
  updateNotAvailable,
  downloadProgress,
  updateDownloaded,
  updateError,
} from './update-state';

const base: UpdateState = { status: 'idle', currentVersion: '0.0.14' };

describe('update-state transitions', () => {
  it('keeps currentVersion sticky across every transition', () => {
    expect(startChecking(base, 'auto').currentVersion).toBe('0.0.14');
    expect(updateAvailable(base, '0.0.15', true).currentVersion).toBe('0.0.14');
    expect(updateNotAvailable(base, 'manual').currentVersion).toBe('0.0.14');
    expect(downloadProgress(base, 50).currentVersion).toBe('0.0.14');
    expect(updateDownloaded(base, '0.0.15').currentVersion).toBe('0.0.14');
    expect(updateError(base, 'boom').currentVersion).toBe('0.0.14');
  });

  it('startChecking records who asked and clears any prior error', () => {
    const prev: UpdateState = { ...base, status: 'error', error: 'old failure' };
    const next = startChecking(prev, 'manual');
    expect(next.status).toBe('checking');
    expect(next.checkInitiatedBy).toBe('manual');
    expect(next.error).toBeUndefined();
  });

  it('auto-downloads on availability when autoDownload is enabled', () => {
    const next = updateAvailable(base, '0.0.15', true, 1000);
    expect(next.status).toBe('downloading');
    expect(next.version).toBe('0.0.15');
    expect(next.progress).toBe(0);
    expect(next.lastCheckedAt).toBe(1000);
  });

  it('only flags availability (no download) when autoDownload is disabled', () => {
    const next = updateAvailable(base, '0.0.15', false, 1000);
    expect(next.status).toBe('available');
    expect(next.version).toBe('0.0.15');
    expect(next.progress).toBeUndefined();
  });

  it('shows "up-to-date" for a manual check but stays idle for a background check', () => {
    expect(updateNotAvailable(base, 'manual', 2000).status).toBe('up-to-date');
    expect(updateNotAvailable(base, 'auto', 2000).status).toBe('idle');
    // Both stamp the check time so Settings can show "last checked …".
    expect(updateNotAvailable(base, 'manual', 2000).lastCheckedAt).toBe(2000);
    expect(updateNotAvailable(base, 'auto', 2000).lastCheckedAt).toBe(2000);
  });

  it('update-not-available clears stale version/progress/error from a prior cycle', () => {
    const prev: UpdateState = { ...base, status: 'error', version: '0.0.99', progress: 42, error: 'x' };
    const next = updateNotAvailable(prev, 'manual', 2000);
    expect(next.version).toBeUndefined();
    expect(next.progress).toBeUndefined();
    expect(next.error).toBeUndefined();
  });

  it('rounds download progress', () => {
    expect(downloadProgress(base, 33.7).progress).toBe(34);
    expect(downloadProgress(base, undefined).progress).toBe(0);
    expect(downloadProgress(base, 33.7).status).toBe('downloading');
  });

  it('marks downloaded at 100% and ready to install', () => {
    const next = updateDownloaded(base, '0.0.15');
    expect(next.status).toBe('downloaded');
    expect(next.version).toBe('0.0.15');
    expect(next.progress).toBe(100);
  });

  it('surfaces errors and does NOT reset to idle (no silent swallowing)', () => {
    const next = updateError(base, 'signature mismatch', 3000);
    expect(next.status).toBe('error');
    expect(next.error).toBe('signature mismatch');
    expect(next.lastCheckedAt).toBe(3000);
    // The status remains 'error' — there is no follow-up transition that hides it.
    expect(next.status).not.toBe('idle');
  });
});
