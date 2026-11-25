import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { PrismaService } from '../database/prisma.service';
import { describeError } from '../../shared/utils/error-stack';

/**
 * Un appel au modèle, compté pour un serveur : les valeurs de la ligne du
 * journal des coûts (`logs/llm.jsonl`), pour que les deux journaux disent la
 * même chose.
 */
export interface UsageLogEntry {
  guildId: string | null;
  requestId?: string | null;
  cause: string;
  capability?: string | null;
  provider?: string | null;
  model: string;
  fallback: boolean;
  promptTokens: number;
  completionTokens: number;
  ms: number;
  ok: boolean;
}

/** Bornes des textes du journal, en caractères : ce qui dépasse est coupé, l'appel se compte quand même. */
const TEXT_LIMITS = { cause: 40, capability: 56, provider: 120, model: 120, requestId: 40 } as const;

/** Plus grand entier d'une colonne Int. */
const INT_MAX = 2_147_483_647;

/** Texte borné, sans ses blancs de bout ; vide si la valeur n'est pas une chaîne. */
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Texte d'une colonne nullable : null quand il est vide ou absent. */
function optionalText(value: unknown, max: number): string | null {
  return text(value, max) || null;
}

/** Entier positif qui tient dans une colonne Int : négatif, fraction, NaN ou infini donnent 0. */
function count(value: unknown): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), INT_MAX) : 0;
}

/**
 * Journal des appels au modèle, par serveur (page Système du dashboard) :
 * fire-and-forget comme l'audit, une écriture ratée n'échoue jamais l'appel
 * compté, mais elle est LOGGÉE (jamais avalée).
 *
 * Sans serveur (appel de niveau instance), rien n'est écrit : aucune page ne
 * pourrait le montrer.
 */
@Injectable()
export class UsageLogService {
  private readonly log = new Logger('Usage');

  constructor(private readonly prisma: PrismaService) {}

  record(entry: UsageLogEntry): void {
    // Tout est dans le try : un `record` ne lève jamais vers l'appelant, même sur une entrée malformée.
    void (async () => {
      let guildId = '';
      let cause = '';
      try {
        guildId = typeof entry.guildId === 'string' ? entry.guildId.trim() : '';
        if (guildId.length === 0) return;
        cause = text(entry.cause, TEXT_LIMITS.cause);
        await this.prisma.llmUsageRow.create({
          data: {
            guildId,
            requestId: optionalText(entry.requestId, TEXT_LIMITS.requestId),
            cause,
            capability: optionalText(entry.capability, TEXT_LIMITS.capability),
            provider: optionalText(entry.provider, TEXT_LIMITS.provider),
            model: optionalText(entry.model, TEXT_LIMITS.model),
            fallback: entry.fallback === true,
            promptTokens: count(entry.promptTokens),
            completionTokens: count(entry.completionTokens),
            ms: count(entry.ms),
            ok: entry.ok === true,
          },
        });
      } catch (error) {
        this.log.warn(`ligne d\u0027usage « ${cause} » du serveur ${guildId} perdue : ${describeError(error).slice(0, 140)}`);
      }
    })();
  }
}
