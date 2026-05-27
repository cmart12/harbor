import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentPersona } from '../../shared/ipc-contract';
import { personaStore } from './persona-store';

function makePersona(overrides: Partial<AgentPersona> & { id: string; handle: string }): AgentPersona {
  return {
    instructions: '',
    model: 'gpt-4',
    runLocation: 'local',
    ...overrides,
  };
}

describe('PersonaStore', () => {
  beforeEach(() => {
    personaStore.setPersonas([]);
  });

  it('has correct initial state after reset', () => {
    expect(personaStore.getState().personas).toEqual([]);
  });

  it('setPersonas() updates personas and notifies listeners', () => {
    const listener = vi.fn();
    const unsub = personaStore.subscribe(listener);

    const personas = [makePersona({ id: 'p1', handle: 'alice' })];
    personaStore.setPersonas(personas);

    expect(personaStore.getState().personas).toEqual(personas);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('getByHandle() returns the persona with matching handle', () => {
    const alice = makePersona({ id: 'p1', handle: 'alice', emoji: '🦊' });
    const bob = makePersona({ id: 'p2', handle: 'bob', emoji: '🐻' });
    personaStore.setPersonas([alice, bob]);

    expect(personaStore.getByHandle('alice')).toEqual(alice);
    expect(personaStore.getByHandle('bob')).toEqual(bob);
  });

  it('getByHandle() returns undefined for unknown handle', () => {
    personaStore.setPersonas([makePersona({ id: 'p1', handle: 'alice' })]);
    expect(personaStore.getByHandle('nope')).toBeUndefined();
  });

  it('subscribe returns a working unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = personaStore.subscribe(listener);

    personaStore.setPersonas([makePersona({ id: 'p1', handle: 'a' })]);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    personaStore.setPersonas([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
