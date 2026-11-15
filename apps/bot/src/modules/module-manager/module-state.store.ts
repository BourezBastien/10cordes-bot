import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STATE_FILE = resolve('output', 'module-states.json');

/**
 * Persists module enabled/disabled states to a JSON file so toggles
 * survive restarts. States absent from the file default to enabled.
 */
export class ModuleStateStore {
  private readonly states: Map<string, boolean>;

  constructor() {
    this.states = this.load();
  }

  isEnabled(moduleId: string): boolean {
    return this.states.get(moduleId) ?? true;
  }

  setEnabled(moduleId: string, enabled: boolean): void {
    this.states.set(moduleId, enabled);
    this.save();
  }

  private load(): Map<string, boolean> {
    if (!existsSync(STATE_FILE)) return new Map();

    try {
      const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Record<string, unknown>;
      const states = new Map<string, boolean>();
      for (const [id, enabled] of Object.entries(raw)) {
        if (typeof enabled === 'boolean') states.set(id, enabled);
      }
      return states;
    } catch {
      return new Map();
    }
  }

  private save(): void {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(this.states), null, 2), 'utf8');
  }
}

/**
 * Single shared instance. Global guards are instantiated with `new` on every
 * interaction (no DI), so the guard must read state from this import-time
 * singleton rather than from an injected service.
 */
export const moduleStateStore = new ModuleStateStore();
