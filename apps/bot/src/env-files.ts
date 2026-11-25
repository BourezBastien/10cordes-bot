import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '@spraxium/env';

/*
 * FICHIERS D'ENVIRONNEMENT DU BOT. Il les charge lui-même, au début de
 * main(), et la CLI Prisma fait pareil (prisma.config.ts) : la même règle aux
 * deux portes.
 *
 * Priorité, de la plus forte à la plus faible : l'environnement du processus,
 * puis `.env.local`, puis `.env`. Sans interpolation des variables. Elle tient
 * à l'ordre de lecture : `.env.local` est lu AVANT `.env`, et une variable déjà
 * définie n'est jamais écrasée.
 *
 * Rien d'autre ne le fait. Le framework Spraxium exporte `loadEnv` mais ne
 * l'appelle pas, et sans chemin il ne lit que le premier fichier trouvé. Jusqu'au
 * 25/11/2026, `.env` (le token, les secrets) était chargé par un effet de bord
 * du client Prisma 6, importé au démarrage ; Prisma 7 ne le fait plus, et le
 * bot a refusé de démarrer (« DISCORD_TOKEN missing ») sur un build dont la CI
 * était verte. Aucune spec ne démarre main() : l'invariant est écrit dans
 * app.module.spec.ts, le chargement est éprouvé dans env-files.spec.ts.
 */

/** Dans l'ordre de lecture : `.env.local` d'abord, et l'emporte sur `.env`. */
export const ENV_FILES = ['.env.local', '.env'] as const;

/** Charge les fichiers d'environnement du projet, sans écraser ce qui est déjà défini ; rend ceux qui existaient, dans l'ordre de lecture. */
export function loadEnvFiles(projectDir: string = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const file of ENV_FILES) {
    const path = resolve(projectDir, file);
    if (!existsSync(path)) continue;
    loadEnv({ path });
    loaded.push(path);
  }
  return loaded;
}
