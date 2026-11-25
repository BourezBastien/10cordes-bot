import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENV_FILES, loadEnvFiles } from './env-files';

/**
 * Le chargement des fichiers d'environnement du bot. Jusqu'au 25/11/2026,
 * `.env` (le token, les secrets) était chargé par un effet de bord du client
 * Prisma 6 : avec Prisma 7 le bot refusait de démarrer. La règle est écrite
 * ici, et elle seule : le processus d'abord, puis `.env.local`, puis `.env`.
 */

const PREFIX = 'TENCORDES_ENV_SPEC_';
/** Définie dans `.env` seulement. */
const ONLY_ENV = `${PREFIX}ONLY_ENV`;
/** Définie dans `.env.local` seulement. */
const ONLY_LOCAL = `${PREFIX}ONLY_LOCAL`;
/** Définie dans les deux fichiers : `.env.local` l'emporte. */
const BOTH = `${PREFIX}BOTH`;
/** Définie dans les deux fichiers et dans le processus : le processus l'emporte. */
const FROM_PROCESS = `${PREFIX}FROM_PROCESS`;
/** Valeur entre guillemets, et valeur suivie d'un commentaire. */
const QUOTED = `${PREFIX}QUOTED`;
const COMMENTED = `${PREFIX}COMMENTED`;
const NAMES = [ONLY_ENV, ONLY_LOCAL, BOTH, FROM_PROCESS, QUOTED, COMMENTED];

const LINES_ENV = ['# lu en second', `${ONLY_ENV}=depuis-env`, `${BOTH}=depuis-env`, `${FROM_PROCESS}=depuis-env`, `${QUOTED}="entre guillemets"`, `${COMMENTED}=valeur # commentaire de fin`];
const LINES_LOCAL = [`${ONLY_LOCAL}=depuis-env-local`, `${BOTH}=depuis-env-local`, `${FROM_PROCESS}=depuis-env-local`];

/** Un dossier jetable, hors du dépôt, avec les fichiers que le bot attend. */
function project(files: Record<string, string[]>): string {
  const dir = mkdtempSync(join(tmpdir(), '10cordes-env-'));
  for (const [name, lines] of Object.entries(files)) writeFileSync(join(dir, name), `${lines.join('\n')}\n`);
  return dir;
}

const discard = (dir: string): void => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 });

const valueOf = (name: string): string | undefined => process.env[name];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of NAMES) delete process.env[name];
});

describe('loadEnvFiles', () => {
  it('lit `.env.local` puis `.env`, rend les fichiers lus dans cet ordre, et retire guillemets et commentaires', () => {
    const dir = project({ '.env': LINES_ENV, '.env.local': LINES_LOCAL });
    try {
      expect(loadEnvFiles(dir)).toEqual(ENV_FILES.map((file) => join(dir, file)));
      expect(valueOf(ONLY_ENV)).toBe('depuis-env');
      expect(valueOf(ONLY_LOCAL)).toBe('depuis-env-local');
      expect(valueOf(QUOTED)).toBe('entre guillemets');
      expect(valueOf(COMMENTED)).toBe('valeur');
    } finally {
      discard(dir);
    }
  });

  it('`.env.local` l\u0027emporte sur `.env`, et l\u0027environnement du processus sur les deux', () => {
    const dir = project({ '.env': LINES_ENV, '.env.local': LINES_LOCAL });
    try {
      vi.stubEnv(FROM_PROCESS, 'du-processus');
      loadEnvFiles(dir);
      expect(valueOf(BOTH)).toBe('depuis-env-local');
      expect(valueOf(FROM_PROCESS)).toBe('du-processus');
    } finally {
      discard(dir);
    }
  });

  it('sans `.env.local`, tout vient de `.env`', () => {
    const dir = project({ '.env': LINES_ENV });
    try {
      expect(loadEnvFiles(dir)).toEqual([join(dir, '.env')]);
      expect(valueOf(BOTH)).toBe('depuis-env');
      expect(valueOf(ONLY_LOCAL)).toBeUndefined();
    } finally {
      discard(dir);
    }
  });

  it('sans aucun fichier, rien n\u0027est lu', () => {
    const dir = project({});
    try {
      expect(loadEnvFiles(dir)).toEqual([]);
      for (const name of NAMES) expect(valueOf(name), name).toBeUndefined();
    } finally {
      discard(dir);
    }
  });

  it('un dossier qui n\u0027est pas celui du projet ne charge rien', () => {
    const dir = project({ '.env': LINES_ENV });
    try {
      expect(loadEnvFiles(join(dir, 'absent'))).toEqual([]);
      expect(valueOf(ONLY_ENV)).toBeUndefined();
    } finally {
      discard(dir);
    }
  });
});
