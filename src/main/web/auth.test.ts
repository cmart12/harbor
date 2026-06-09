import { describe, expect, it } from 'vitest';
import { constantTimeTokenEqual, extractWebSocketProtocolToken, WebRemoteAuthenticator } from './auth';

describe('web remote auth', () => {
  it('compares tokens by digest', () => {
    expect(constantTimeTokenEqual('secret-token', 'secret-token')).toBe(true);
    expect(constantTimeTokenEqual('secret-token', 'other-token')).toBe(false);
  });

  it('accepts valid tokens and rejects invalid tokens', () => {
    const auth = new WebRemoteAuthenticator(() => 'secret-token');

    expect(auth.authenticate('secret-token', '127.0.0.1').ok).toBe(true);
    const rejected = auth.authenticate('wrong', '127.0.0.1');
    expect(rejected.ok).toBe(false);
    expect(rejected.status).toBe(401);
  });

  it('locks out repeated failures by address', () => {
    const auth = new WebRemoteAuthenticator(() => 'secret-token');

    for (let i = 0; i < 5; i++) {
      auth.authenticate('wrong', '100.64.0.10');
    }

    const result = auth.authenticate('secret-token', '100.64.0.10');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });

  it('extracts websocket protocol tokens', () => {
    expect(extractWebSocketProtocolToken('chat, whim-token.abc123')).toBe('abc123');
    expect(extractWebSocketProtocolToken(undefined)).toBeNull();
  });
});
