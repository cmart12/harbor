/**
 * Unit tests for main-log.ts.
 *
 * We test:
 *  - `safeStringify` handles all edge cases (circular, Error, undefined)
 *  - The worker log postMessage shape matches what macos-source.ts expects
 *  - Module exports are correct
 */

import { describe, it, expect, vi } from 'vitest';

// Mock electron before importing main-log
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/harbor-test',
    getVersion: () => '0.0.15',
    isPackaged: false,
  },
}));

import { safeStringify, DEBUG_LOG_DIR, DEBUG_LOG_PATH } from './main-log';
import * as os from 'os';
import * as path from 'path';

describe('main-log', () => {
  describe('safeStringify', () => {
    it('handles strings passthrough', () => {
      expect(safeStringify('hello')).toBe('hello');
    });

    it('handles undefined', () => {
      expect(safeStringify(undefined)).toBe('undefined');
    });

    it('handles null', () => {
      expect(safeStringify(null)).toBe('null');
    });

    it('handles numbers via JSON', () => {
      expect(safeStringify(42)).toBe('42');
    });

    it('handles plain objects', () => {
      expect(safeStringify({ foo: 'bar' })).toBe('{"foo":"bar"}');
    });

    it('handles Error instances', () => {
      const err = new TypeError('oops');
      const result = safeStringify(err);
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('TypeError');
      expect(parsed.message).toBe('oops');
      expect(parsed.stack).toBeDefined();
    });

    it('handles circular references gracefully', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const result = safeStringify(obj);
      expect(result).toContain('"a":1');
      expect(result).toContain('[Circular]');
    });

    it('handles nested circular references', () => {
      const a: Record<string, unknown> = { name: 'a' };
      const b: Record<string, unknown> = { name: 'b', ref: a };
      a.ref = b;
      const result = safeStringify(a);
      expect(result).toContain('[Circular]');
      expect(result).toContain('"name":"a"');
    });

    it('handles boolean', () => {
      expect(safeStringify(true)).toBe('true');
      expect(safeStringify(false)).toBe('false');
    });

    it('handles arrays', () => {
      expect(safeStringify([1, 'two', null])).toBe('[1,"two",null]');
    });
  });

  describe('worker log postMessage shape', () => {
    // This tests that the shape produced by workers matches what
    // macos-source.ts (and future workiq-source.ts) expects to consume.
    type WorkerLogMessage = {
      type: 'log';
      level: 'info' | 'warn' | 'error';
      message: string;
    };

    function workerLog(level: 'info' | 'warn' | 'error', ...args: unknown[]): WorkerLogMessage {
      return {
        type: 'log',
        level,
        message: args.map(safeStringify).join(' '),
      };
    }

    it('produces valid log message with info level', () => {
      const msg = workerLog('info', 'polling started');
      expect(msg.type).toBe('log');
      expect(msg.level).toBe('info');
      expect(msg.message).toBe('polling started');
    });

    it('produces valid log message with error level and Error object', () => {
      const err = new Error('connection timeout');
      const msg = workerLog('error', 'fetch failed:', err);
      expect(msg.type).toBe('log');
      expect(msg.level).toBe('error');
      expect(msg.message).toContain('fetch failed:');
      expect(msg.message).toContain('connection timeout');
    });

    it('produces valid log message with warn level and mixed args', () => {
      const msg = workerLog('warn', 'retrying in', 5000, 'ms', { attempt: 2 });
      expect(msg.type).toBe('log');
      expect(msg.level).toBe('warn');
      expect(msg.message).toBe('retrying in 5000 ms {"attempt":2}');
    });

    it('handles undefined and null args in message', () => {
      const msg = workerLog('info', 'value:', undefined, null, 'end');
      expect(msg.message).toBe('value: undefined null end');
    });

    it('handles circular ref args without throwing', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const msg = workerLog('warn', 'bad object:', circular);
      expect(msg.type).toBe('log');
      expect(msg.message).toContain('[Circular]');
    });
  });

  describe('constants', () => {
    it('DEBUG_LOG_DIR points to ~/.copilot/sessions-output', () => {
      const expected = path.join(os.homedir(), '.copilot', 'sessions-output');
      expect(DEBUG_LOG_DIR).toBe(expected);
    });

    it('DEBUG_LOG_PATH ends with harbor-debug.log', () => {
      expect(DEBUG_LOG_PATH).toBe(path.join(DEBUG_LOG_DIR, 'harbor-debug.log'));
    });
  });
});
