import { Prisma } from '../../../generated/prisma/client.mts';
import type { ToolResult } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';
import { epochMsOf } from '../database/sql-dialect';
import { describeCoverage } from './activity-coverage';

/** Un agrégat SQL : COUNT et SUM reviennent en nombres sous SQLite, en BigInt sous PostgreSQL ; les deux se comptent pareil. */
type Aggregate = number | bigint;

/**
 * Résumé d'activité d'un serveur, en SQL agrégé sur l'audit des messages et
 * sur le compteur de temps vocal : volume par jour, arrivées/départs, top
 * membres de la fenêtre et couverture temporelle réelle des données. Lecture
 * seule.
 */
export async function summarizeActivity(prisma: PrismaService, guildId: string, days: number): Promise<ToolResult> {
  const since = new Date(Date.now() - days * 86_400_000);

  // SQL 100% PARAMÉTRÉ (Prisma.sql, jamais de concaténation), le même sur les
  // deux moteurs : la borne de la fenêtre est une Date, et seul le jour local
  // passe par le dialecte. Sous SQLite, strftime ne lit pas l'entier
  // millisecondes tel quel (il rendrait NULL : tous les jours sous « null »),
  // d'où la division du dialecte ; sous PostgreSQL, c'est un date_trunc dans
  // le fuseau du processus. Les jours sont ceux du fuseau du processus, comme
  // toLocalDay. MIN d'une date revient en nombre (SQLite) ou en Date
  // (PostgreSQL) : epochMsOf les ramène aux millisecondes.
  // Les alias sont cités : PostgreSQL rabat en minuscules un alias nu (`AS userId`
  // y rend `userid`, et la colonne devient introuvable ; vu sur un serveur réel).
  const day = prisma.dialect.dayOf(Prisma.sql`"createdAt"`);
  const [perDay, coverage, joins, topMembers] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string | null; messages: Aggregate }>>(
      Prisma.sql`SELECT ${day} AS "day", COUNT(*) AS "messages"
                         FROM "audit_logs"
                         WHERE "guildId" = ${guildId} AND "action" = ${'message.created'} AND "createdAt" >= ${since}
                         GROUP BY "day" ORDER BY "day" ASC LIMIT 90`,
    ),
    prisma.$queryRaw<Array<{ since: unknown }>>(
      Prisma.sql`SELECT MIN("createdAt") AS "since" FROM "audit_logs"
                         WHERE "guildId" = ${guildId} AND "action" = ${'message.created'}`,
    ),
    prisma.$queryRaw<Array<{ joined: Aggregate | null; left: Aggregate | null }>>(
      Prisma.sql`SELECT
                 SUM(CASE WHEN "action" = ${'member.joined'} THEN 1 ELSE 0 END) AS "joined",
                 SUM(CASE WHEN "action" = ${'member.left'} THEN 1 ELSE 0 END) AS "left"
                 FROM "audit_logs"
                 WHERE "guildId" = ${guildId} AND "action" IN (${'member.joined'}, ${'member.left'}) AND "createdAt" >= ${since}`,
    ),
    // Top membres SUR LA FENÊTRE : l'audit porte l'auteur de chaque
    // message humain. memberActivity est un cumul depuis toujours
    // (il faisait annoncer 9 messages là où la fenêtre en compte 7).
    prisma.$queryRaw<Array<{ userId: string; messages: Aggregate }>>(
      Prisma.sql`SELECT "actorId" AS "userId", COUNT(*) AS "messages"
                         FROM "audit_logs"
                         WHERE "guildId" = ${guildId} AND "action" = ${'message.created'} AND "createdAt" >= ${since} AND "actorId" IS NOT NULL
                         GROUP BY "actorId" ORDER BY "messages" DESC, "actorId" ASC LIMIT 5`,
    ),
  ]);
  // Pas de suivi du vocal par fenêtre : minutes CUMULÉES, annoncées comme telles.
  const voiceRows =
    topMembers.length > 0
      ? await prisma.memberActivity.findMany({
          where: { guildId, userId: { in: topMembers.map((row) => row.userId) } },
          select: { userId: true, voiceMinutes: true },
        })
      : [];
  const voiceMinutesByUser = new Map(voiceRows.map((row) => [row.userId, row.voiceMinutes]));

  const dayRows = perDay.filter((row): row is { day: string; messages: Aggregate } => row.day !== null);
  const totalMessages = dayRows.reduce((sum, row) => sum + Number(row.messages), 0);
  const coverageSinceMs = epochMsOf(coverage[0]?.since);
  const coverageFacts = describeCoverage({ sinceMs: coverageSinceMs, days });
  const effectiveDays = coverageFacts.effectiveDays;
  const perDayLines = dayRows.map((row) => `${row.day}: ${Number(row.messages)} msg`);
  const topLines = topMembers.map(
    (row, index) =>
      `${index + 1}. <@${row.userId}> (${Number(row.messages)} msg sur la fenêtre, ${voiceMinutesByUser.get(row.userId) ?? 0} min de vocal en cumul)`,
  );
  const summary = [
    `${totalMessages} message(s) humain(s) sur la fenêtre, réparti(s) sur ${dayRows.length} jour(s) différent(s) (moyenne ${dayRows.length > 0 ? Math.round(totalMessages / effectiveDays) : 0}/jour).`,
    `Arrivées: ${Number(joins[0]?.joined ?? 0)}, départs: ${Number(joins[0]?.left ?? 0)}.`,
    perDayLines.length > 0 ? `Par jour : ${perDayLines.join(' | ')}` : '',
    topLines.length > 0 ? `Top membres : ${topLines.join(' | ')}` : 'Aucun message de membre sur la fenêtre.',
    coverageFacts.line
  ]
    .filter(Boolean)
    .join('\n');
  return {
    ok: true,
    summary,
    data: {
      days,
      totalMessages,
      coverageSince: coverageSinceMs !== null ? new Date(coverageSinceMs).toISOString() : null,
      effectiveDays,
      joined: Number(joins[0]?.joined ?? 0),
      left: Number(joins[0]?.left ?? 0),
      perDay: dayRows.map((row) => ({ day: row.day, messages: Number(row.messages) })),
      topMembers: topMembers.map((row) => ({
        userId: row.userId,
        messages: Number(row.messages),
        voiceMinutesCumul: voiceMinutesByUser.get(row.userId) ?? 0,
      })),
    },
  };
}
