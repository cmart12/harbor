import React, { useEffect, useState, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UpdateState } from '../../shared/types';

const api = (window as any).whimAPI;

function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!api?.onUpdateStateChanged) return;
    const unsub = api.onUpdateStateChanged((s: UpdateState) => {
      setState(s);
      // Re-show banner when a new update arrives or download completes
      if (s.status === 'available' || s.status === 'downloaded') {
        setDismissed(false);
      }
    });
    return unsub;
  }, []);

  const handleInstall = useCallback(() => {
    api?.installUpdate();
  }, []);

  const handleDownload = useCallback(() => {
    api?.downloadUpdate();
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!state || dismissed) return null;

  const { status, version, progress } = state;

  if (status === 'available') {
    return (
      <div className="update-banner update-banner--available">
        <span className="update-banner__text">
          A new version{version ? ` (v${version})` : ''} is available
        </span>
        <button className="update-banner__btn" onClick={handleDownload}>Download</button>
        <button className="update-banner__dismiss" onClick={handleDismiss} title="Dismiss">✕</button>
      </div>
    );
  }

  if (status === 'downloading') {
    return (
      <div className="update-banner update-banner--downloading">
        <span className="update-banner__text">
          Downloading update{version ? ` (v${version})` : ''}… {progress != null ? `${progress}%` : ''}
        </span>
        <div className="update-banner__progress">
          <div className="update-banner__progress-bar" style={{ width: `${progress ?? 0}%` }} />
        </div>
      </div>
    );
  }

  if (status === 'downloaded') {
    return (
      <div className="update-banner update-banner--ready">
        <span className="update-banner__text">
          Update ready{version ? ` (v${version})` : ''} — restart to apply
        </span>
        <button className="update-banner__btn" onClick={handleInstall}>Restart Now</button>
        <button className="update-banner__dismiss" onClick={handleDismiss} title="Dismiss">✕</button>
      </div>
    );
  }

  return null;
}

let root: Root | null = null;

export function mountUpdateBanner(container: HTMLElement): void {
  if (root) root.unmount();
  root = createRoot(container);
  root.render(<UpdateBanner />);
}

export function unmountUpdateBanner(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
