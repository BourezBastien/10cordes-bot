/**
 * Couverture temporelle d'un résumé d'activité : à quelle date remontent les
 * données RÉELLES, par rapport à la fenêtre demandée. Une moyenne par jour
 * n'a de sens que sur cette profondeur (7 jours demandés, 21 h de données).
 */

/** Jour local YYYY-MM-DD (même fuseau que le 'localtime' de SQLite). */
export function toLocalDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface CoverageFacts {
  /** Date (epoch-ms) de la plus ancienne donnée comptée, null si aucune. */
  sinceMs: number | null;
  /** Fenêtre demandée, en jours. */
  days: number;
  /** Horloge injectable (défaut : maintenant). */
  now?: number;
}

export interface CoverageSummary {
  /** Jours réellement couverts, bornés à [1, days] ; 0 sans aucune donnée. */
  effectiveDays: number;
  /** Ligne à recopier telle quelle dans le résumé du tool. */
  line: string;
}

const DAY_MS = 86_400_000;

export function describeCoverage({ sinceMs, days, now = Date.now() }: CoverageFacts): CoverageSummary {
  if (sinceMs === null) return { effectiveDays: 0, line: 'coverageSince: aucune donnée.' };

  const elapsedDays = Math.max(0, (now - sinceMs) / DAY_MS);
  const effectiveDays = Math.min(days, Math.max(1, Math.ceil(elapsedDays)));
  // Profondeur lisible : « 2 jours de messages » puis « fenêtre effective de
  // 1 jour » se contredisaient (21 h écoulées à cheval sur deux jours calendaires).
  const depthLabel = elapsedDays < 2 ? `${Math.max(1, Math.round(elapsedDays * 24))} h` : `${elapsedDays.toFixed(1).replace('.', ',')} j`;
  const day = toLocalDay(new Date(sinceMs));

  const line =
    elapsedDays >= days
      ? `coverageSince: ${day} (données complètes sur toute la fenêtre de ${days} jour(s)).`
      : `coverageSince: ${day} (première donnée il y a ${depthLabel} : la fenêtre de ${days} jour(s) n\u0027est couverte que sur ${effectiveDays} jour(s) ; la moyenne se calcule sur cette profondeur).`;
  return { effectiveDays, line };
}
