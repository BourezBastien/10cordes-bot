import { Injectable } from '@spraxium/common';

/**
 * Étapes d'une demande de l'agent venue du dashboard, EN MÉMOIRE : ce que le
 * panel montre pendant que la demande tourne (les outils appelés, réussis ou
 * non), puis à la fin. Le flux Discord reste muet pendant le travail ; le
 * panel, lui, a le droit de montrer la progression de CELLE qu'il a lancée.
 *
 * Trois règles :
 * - une demande n'est lisible que depuis SON serveur : l'identifiant est
 *   choisi par le client, deux serveurs peuvent en choisir un semblable ;
 * - tout est borné (taille des textes, nombre de demandes, durée de vie) :
 *   rien ici ne grossit avec l'activité ;
 * - tout se perd au redémarrage : une demande perdue répond 404, et le panel
 *   continue de montrer qu'elle est en cours, sans rien inventer.
 */

export type RequestState = 'running' | 'done' | 'failed';

export interface RequestStep {
  /** Nom de l'outil appelé. */
  name: string;
  ok: boolean;
  /** Ce que l'outil a rendu en clair (le résumé de son résultat), borné. */
  summary: string;
}

export interface RequestProgress {
  requestId: string;
  state: RequestState;
  steps: RequestStep[];
}

interface Entry extends RequestProgress {
  guildId: string;
  touchedAt: number;
}

/** Bornes d'une étape : un nom d'outil, un résumé court. */
export const STEP_NAME_MAX = 80;
export const STEP_SUMMARY_MAX = 300;
/** Demandes gardées au plus, et durée de vie d'une demande terminée. */
export const PROGRESS_MAX_ENTRIES = 200;
export const PROGRESS_RETENTION_MS = 10 * 60_000;

/**
 * Identifiant d'une demande du panel : choisi par le client. Quatre caractères
 * de préfixe, puis 8 à 36 : l'identifiant fait 40 caractères au plus, la place
 * qu'on lui garde dans le journal d'usage.
 */
const REQUEST_ID = /^web-[a-z0-9-]{8,36}$/u;

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

/** Identifiant d'une demande connu du service : `web-` puis lettres, chiffres ou tirets (8 à 36). */
export const REQUEST_ID_PATTERN = REQUEST_ID.source;

@Injectable()
export class RequestProgressService {
  /** Par serveur, puis par identifiant de demande. */
  private readonly entries = new Map<string, Map<string, Entry>>();

  /** Une demande démarre : vide, en cours. Une demande de même identifiant sur ce serveur est remplacée. */
  start(guildId: string, requestId: string): void {
    this.sweep();
    this.guildEntries(guildId).set(requestId, { requestId, guildId, state: 'running', steps: [], touchedAt: Date.now() });
    // Le nettoyage passe APRÈS l'entrée nouvelle : le plafond tient dès cette écriture (elle est en cours, jamais évictée).
    this.sweep();
  }

  /** Un outil a rendu son résultat : l'étape s'ajoute, dans l'ordre. Une demande inconnue n'enregistre rien. */
  record(guildId: string, requestId: string, step: RequestStep): void {
    const entry = this.entries.get(guildId)?.get(requestId);
    if (!entry) return;
    entry.steps.push({ name: step.name.slice(0, STEP_NAME_MAX), ok: step.ok === true, summary: step.summary.slice(0, STEP_SUMMARY_MAX) });
    entry.touchedAt = Date.now();
  }

  /** La demande est finie : son état est clos, ses étapes restent lisibles un temps. */
  finish(guildId: string, requestId: string, state: Exclude<RequestState, 'running'>): void {
    const entry = this.entries.get(guildId)?.get(requestId);
    if (!entry) return;
    entry.state = state;
    entry.touchedAt = Date.now();
  }

  /** Étapes d'une demande de CE serveur ; null si elle lui est inconnue (jamais celle d'un autre). */
  read(guildId: string, requestId: string): RequestProgress | null {
    this.sweep();
    const entry = this.entries.get(guildId)?.get(requestId);
    if (!entry) return null;
    return { requestId: entry.requestId, state: entry.state, steps: entry.steps.map((step) => ({ ...step })) };
  }

  /** Demandes gardées pour un serveur (diagnostic). */
  count(guildId: string): number {
    return this.entries.get(guildId)?.size ?? 0;
  }

  private guildEntries(guildId: string): Map<string, Entry> {
    let guild = this.entries.get(guildId);
    if (!guild) {
      guild = new Map();
      this.entries.set(guildId, guild);
    }
    return guild;
  }

  /**
   * Nettoyage : les demandes terminées de plus de dix minutes partent, et le
   * nombre de demandes gardées reste sous le plafond (les plus anciennes d'abord).
   * Une demande en cours n'expire pas : la boucle de l'agent la clôt.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [guildId, guild] of this.entries) {
      for (const [requestId, entry] of guild) {
        if (entry.state !== 'running' && now - entry.touchedAt > PROGRESS_RETENTION_MS) guild.delete(requestId);
      }
      if (guild.size === 0) this.entries.delete(guildId);
    }
    let total = 0;
    for (const guild of this.entries.values()) total += guild.size;
    if (total <= PROGRESS_MAX_ENTRIES) return;
    const oldest = [...this.entries.values()].flatMap((guild) => [...guild.values()]).filter((entry) => entry.state !== 'running').sort((a, b) => a.touchedAt - b.touchedAt);
    for (const entry of oldest) {
      if (total <= PROGRESS_MAX_ENTRIES) break;
      this.entries.get(entry.guildId)?.delete(entry.requestId);
      total -= 1;
    }
  }
}
