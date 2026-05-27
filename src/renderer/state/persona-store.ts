import type { AgentPersona } from '../../shared/ipc-contract';

export interface PersonaState {
  personas: AgentPersona[];
}

type Listener = () => void;

/**
 * Minimal store for agent personas.
 *
 * The Settings panel (still in legacy app.ts) owns persona CRUD. Whenever it
 * loads or saves personas, it pushes the updated list into this store so the
 * React Agent list can render persona emojis reactively without depending on
 * a module-level `let personas` in app.ts.
 */
class PersonaStore {
  private state: PersonaState = {
    personas: [],
  };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<PersonaState> {
    return this.state;
  }

  setPersonas(personas: AgentPersona[]): void {
    this.state = { ...this.state, personas };
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- Derived state helpers --------------------------------------------------

  getByHandle(handle: string): AgentPersona | undefined {
    return this.state.personas.find(p => p.handle === handle);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const personaStore = new PersonaStore();
