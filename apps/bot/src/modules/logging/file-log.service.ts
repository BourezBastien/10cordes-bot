import { mkdirSync, appendFileSync, statSync, unlinkSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';

/**
 * FileLogService (R3) — logging fichier ULTRA POUSSÉ pour auditer le bot en
 * local : chaque événement clé (gate, boucle LLM, tools, surfaces, triggers,
 * intégrations, santé) devient une ligne JSONL exploitable.
 *
 * - logs/bot-YYYY-MM-DD.jsonl : { ts, level, ctx, event, data }
 * - logs/llm.jsonl : { ts, cause, model, promptTokens, completionTokens, ms, ok }
 * - Rotation quotidienne par date + purge > MAX_FILES ; garde-fou taille.
 * - Le miroir console brut (bot-out.log ANSI) est REMPLACÉ par ce service :
 *   la console reste intacte, tout transite aussi en JSONL strippé.
 */

export type FileLogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOGS_DIR = resolve(process.cwd(), 'logs');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_STREAM = 7;
const ANSI_RE = /\u001B\[[0-9;]*[A-Za-z]/gu;

interface JsonlEntry {
  ts: string;
  level: FileLogLevel;
  ctx: string;
  event: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class FileLogService implements SpraxiumOnBoot {
  private readonly log = new Logger('FileLog');
  private currentDate = '';
  private mirrorInstalled = false;

  onBoot(): void {
    setFileLog(this);
    try {
      mkdirSync(LOGS_DIR, { recursive: true });
      this.rotateIfNeeded();
      this.installConsoleMirror();
      this.log.info(`Logging JSONL actif : ${LOGS_DIR}`);
    } catch (error) {
      this.log.warn(`Logging fichier indisponible : ${(error as Error).message.slice(0, 100)}`);
    }
  }

  /** Événement structuré (chokepoint unique de l'application). */
  event(level: FileLogLevel, ctx: string, event: string, data?: Record<string, unknown>): void {
    const entry: JsonlEntry = { ts: new Date().toISOString(), level, ctx, event, ...(data ? { data } : {}) };
    this.append(this.botFile(), JSON.stringify(entry));
  }

  /** Ligne dédiée LLM (coûts/latence par cause). `provider` : qui a exécuté le tour (moteur multi-fournisseurs). */
  llm(entry: {
    cause: string;
    model: string;
    provider?: string;
    fallback?: boolean;
    /** Capacité routée qui a servi le tour (chat.default, chat.reasoning, chat.ingestion). */
    capability?: string;
    promptTokens: number;
    completionTokens: number;
    ms: number;
    ok: boolean;
    error?: string;
  }): void {
    this.append(join(LOGS_DIR, 'llm.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry, ...(entry.error ? { error: entry.error.slice(0, 180) } : {}) }));
  }

  private botFile(): string {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.rotateIfNeeded();
    }
    return join(LOGS_DIR, `bot-${today}.jsonl`);
  }

  private append(file: string, line: string): void {
    try {
      appendFileSync(file, `${line}\n`, 'utf8');
      this.guardSize(file);
    } catch {
      /* le logging ne casse JAMAIS l'app */
    }
  }

  /** Garde-fou taille : renomme en .1/.2 et purge au-delà de MAX_FILES. */
  private guardSize(file: string): void {
    try {
      if (!existsSync(file) || statSync(file).size < MAX_FILE_BYTES) return;
      for (let index = MAX_FILES_PER_STREAM - 1; index >= 1; index -= 1) {
        const from = `${file}.${index}`;
        const to = `${file}.${index + 1}`;
        if (existsSync(from)) renameSync(from, to);
      }
      renameSync(file, `${file}.1`);
      this.purgeOld(file);
    } catch {
      /* best effort */
    }
  }

  /** Purge des fichiers de logs au-delà de la fenêtre de rétention. */
  private rotateIfNeeded(): void {
    try {
      if (!existsSync(LOGS_DIR)) return;
      const prefix = 'bot-';
      const files = readdirSync(LOGS_DIR)
        .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
        .sort()
        .reverse();
      for (const name of files.slice(MAX_FILES_PER_STREAM)) {
        unlinkSync(join(LOGS_DIR, name));
      }
    } catch {
      /* best effort */
    }
  }

  private purgeOld(file: string): void {
    try {
      const dir = dirname(file);
      const base = file.split(/[\\/]/).pop() ?? '';
      const rotated = readdirSync(dir).filter((name) => name.startsWith(`${base}.`)).sort();
      for (const name of rotated.slice(MAX_FILES_PER_STREAM)) {
        unlinkSync(join(dir, name));
      }
    } catch {
      /* best effort */
    }
  }

  /**
   * Miroir console → JSONL strippé : TOUT ce que le bot écrit en console
   * (framework, logs métier, tables de boot) est aussi capturé en clair,
   * remplaçant l'ancien miroir ANSI de main.ts.
   */
  private installConsoleMirror(): void {
    if (this.mirrorInstalled) return;
    this.mirrorInstalled = true;
    const wrap = (original: (chunk: string | Uint8Array) => boolean, stream: 'stdout' | 'stderr') =>
      ((...args: Parameters<typeof original>) => {
        try {
          const text = typeof args[0] === 'string' ? args[0] : Buffer.from(args[0] ?? '').toString('utf8');
          const clean = text.replace(ANSI_RE, '').trimEnd();
          if (clean.length > 0) {
            const entry = JSON.stringify({ ts: new Date().toISOString(), level: stream === 'stderr' ? 'error' : 'info', ctx: 'console', event: 'line', data: { text: clean.slice(0, 2000) } });
            appendFileSync(this.botFile(), `${entry}\n`, 'utf8');
          }
        } catch {
          /* jamais fatal */
        }
        try {
          return original(...args);
        } catch {
          return true;
        }
      }) as typeof original;
    if (typeof process.stdout?.write === 'function') {
      process.stdout.write = wrap(process.stdout.write.bind(process.stdout), 'stdout');
    }
    if (typeof process.stderr?.write === 'function') {
      process.stderr.write = wrap(process.stderr.write.bind(process.stderr), 'stderr');
    }
  }
}

/** Accès process-global (chokepoints statiques : gate, registry...). */
let globalFileLog: FileLogService | null = null;

export function setFileLog(instance: FileLogService): void {
  globalFileLog = instance;
}

export function fileLog(): Pick<FileLogService, 'event' | 'llm'> | null {
  return globalFileLog;
}
