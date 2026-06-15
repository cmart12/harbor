/**
 * Notification source interface (Phase A.2 macOS, Phase C WorkIQ + Slack).
 *
 * A source is anything that knows how to feed notification rows into the
 * sidecar DB. Phase A.2 implements `macos-source.ts`; the same interface
 * will gate WorkIQ and Slack sources in Phase C so they plug into the same
 * lifecycle (start on app ready, stop on app quit).
 */
export interface NotifSource {
  /** Human-readable identifier, e.g. 'macos'. Logged on errors. */
  readonly name: string;

  /**
   * Begin polling / streaming. Idempotent: a second call should be a no-op
   * unless `stop()` was called first.
   */
  start(): Promise<void>;

  /**
   * Tear down the source. Must wait for in-flight work to settle so we don't
   * leak workers or open DB connections at app quit.
   */
  stop(): Promise<void>;
}
