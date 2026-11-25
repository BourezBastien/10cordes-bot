import { Injectable } from '@spraxium/common';
import { USAGE_WINDOW_HOURS, type UsageByModel, type UsageDay, type UsageSummary, type UsageWindow } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';

/** Modèles gardés dans le détail : les plus gourmands d'abord. */
const MODEL_TOP = 25;

/** Étiquette d'un appel que ne dessert aucun modèle de la table (même mot que le journal des coûts). */
const UNROUTED_MODEL = 'runtime';

/** Un agrégat SQL : avec Prisma 7 et l'adaptateur libsql, COUNT et SUM reviennent en nombres ; un BigInt reste admis. */
type Aggregate = number | bigint | null;

/** Un fournisseur et un modèle : ce qu'ils ont consommé sur la fenêtre. */
interface ModelRow {
  provider: string | null;
  model: string | null;
  turns: Aggregate;
  promptTokens: Aggregate;
  completionTokens: Aggregate;
  errors: Aggregate;
  fallbacks: Aggregate;
}

/** Une journée locale : ce qu'elle a consommé sur la fenêtre. */
interface DayRow {
  day: string;
  turns: Aggregate;
  tokens: Aggregate;
}

/** Nombre de la réponse : l'agrégat devient un nombre entier positif. */
function toCount(value: Aggregate): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/** Ordre des textes par unités de code, identique sur toutes les machines : deux modèles à égalité gardent toujours le même ordre. */
function compareText(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

/** Jour local du processus, `AAAA-MM-JJ` : l'écriture de `strftime('%Y-%m-%d', ..., 'localtime')`. */
function localDay(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/**
 * Lecture du journal des appels au modèle, pour la page Système d'un serveur :
 * totaux, détail par modèle et consommation par jour sur une fenêtre. Les
 * dates de la table sont des millisecondes (entier) : la fenêtre compare donc
 * deux entiers, jamais une date à un texte.
 */
@Injectable()
export class UsageReaderService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(guildId: string, window: UsageWindow): Promise<UsageSummary> {
    const now = Date.now();
    const since = now - USAGE_WINDOW_HOURS[window] * 3_600_000;
    const [models, days] = await Promise.all([this.modelsOf(guildId, since), this.dayRowsOf(guildId, since)]);
    const counted = this.shape(models);
    return { window, ...counted, byDay: this.fillDays(days, since, now) };
  }

  /** Une ligne par fournisseur et modèle : tours, jetons, erreurs (appels ratés) et replis de la fenêtre. */
  private modelsOf(guildId: string, since: number): Promise<ModelRow[]> {
    return this.prisma.$queryRaw<ModelRow[]>`
      SELECT "provider", "model",
             COUNT(*) AS "turns",
             SUM("promptTokens") AS "promptTokens",
             SUM("completionTokens") AS "completionTokens",
             SUM(CASE WHEN "ok" = 0 THEN 1 ELSE 0 END) AS "errors",
             SUM(CASE WHEN "fallback" = 1 THEN 1 ELSE 0 END) AS "fallbacks"
      FROM "llm_usage_rows"
      WHERE "guildId" = ${guildId} AND "createdAt" >= ${since}
      GROUP BY "provider", "model"
    `;
  }

  /** Une ligne par journée locale : tours et jetons de la fenêtre, du jour le plus ancien au plus récent. */
  private dayRowsOf(guildId: string, since: number): Promise<DayRow[]> {
    return this.prisma.$queryRaw<DayRow[]>`
      SELECT strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch', 'localtime') AS "day",
             COUNT(*) AS "turns",
             SUM("promptTokens" + "completionTokens") AS "tokens"
      FROM "llm_usage_rows"
      WHERE "guildId" = ${guildId} AND "createdAt" >= ${since}
      GROUP BY "day"
      ORDER BY "day"
    `;
  }

  /** Détail par modèle (les 25 plus gourmands) et totaux de TOUTES les lignes de la fenêtre, pas des 25 seules. */
  private shape(rows: ModelRow[]): Pick<UsageSummary, 'turns' | 'promptTokens' | 'completionTokens' | 'errors' | 'fallbacks' | 'byModel'> {
    const models: UsageByModel[] = rows.map((row) => ({
      provider: row.provider,
      model: row.model || UNROUTED_MODEL,
      turns: toCount(row.turns),
      promptTokens: toCount(row.promptTokens),
      completionTokens: toCount(row.completionTokens),
      errors: toCount(row.errors),
      fallbacks: toCount(row.fallbacks),
    }));
    const sum = (pick: (model: UsageByModel) => number): number => models.reduce((total, model) => total + pick(model), 0);
    const byTokens = (left: UsageByModel, right: UsageByModel): number =>
      right.promptTokens + right.completionTokens - (left.promptTokens + left.completionTokens) || compareText(left.provider, right.provider) || compareText(left.model, right.model);
    return {
      turns: sum((model) => model.turns),
      promptTokens: sum((model) => model.promptTokens),
      completionTokens: sum((model) => model.completionTokens),
      errors: sum((model) => model.errors),
      fallbacks: sum((model) => model.fallbacks),
      byModel: [...models].sort(byTokens).slice(0, MODEL_TOP),
    };
  }

  /** Les journées de la fenêtre, de celle du début à aujourd'hui : celle qui n'a aucun appel vaut zéro, pour un axe continu. */
  private fillDays(rows: DayRow[], since: number, now: number): UsageDay[] {
    const counted = new Map(rows.map((row) => [row.day, { day: row.day, turns: toCount(row.turns), tokens: toCount(row.tokens) }]));
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const cursor = new Date(since);
    cursor.setHours(0, 0, 0, 0);
    const days: UsageDay[] = [];
    // Jour calendaire après jour calendaire, jamais 24 h de plus : un changement d'heure ne saute ni ne répète un jour.
    for (; cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
      const day = localDay(cursor);
      days.push(counted.get(day) ?? { day, turns: 0, tokens: 0 });
    }
    return days;
  }
}
