import { Prisma } from '../../../generated/prisma/client.mts';
import type { ToolResult } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';
import { describeCoverage } from './activity-coverage';

/**
 * Résumé d'activité d'un serveur, en SQL agrégé sur l'audit des messages et
 * sur le compteur de temps vocal : volume par jour, arrivées/départs, top
 * membres de la fenêtre et couverture temporelle réelle des données. Lecture
 * seule.
 */
export async function summarizeActivity(prisma: PrismaService, guildId: string, days: number): Promise<ToolResult> {
  const since = new Date(Date.now() - days * 86_400_000);

  // SQL 100% PARAMÉTRÉ (Prisma.sql, jamais de concaténation).
  // Piège SQLite + Prisma : les DateTime sont stockés en epoch-ms
  // ENTIER (le format de Prisma 6, que l'adaptateur garde : database-client.ts).
  // strftime ne lit pas cet entier tel quel (il renvoyait
  // NULL : tous les jours se regroupaient sous « null »), d'où le
  // / 1000 + 'unixepoch'. COUNT et MIN ressortent en nombres : convertis
  // par Number quand même, qui laisse un nombre tel quel.
  // 'localtime' : jours du fuseau du processus, cohérents avec toLocalDay.
  const [perDay, coverage, joins, topMembers] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string | null; messages: number }>>(
      Prisma.sql`SELECT strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS messages
                         FROM "audit_logs"
                         WHERE "guildId" = ${guildId} AND "action" = ${'message.created'} AND "createdAt" >= ${since}
                         GROUP BY day ORDER BY day ASC LIMIT 90`,
    ),
    prisma.$queryRaw<Array<{ since: number | null }>>(
      Prisma.sql`SELECT MIN("createdAt") AS since FROM "audit_logs"
                         WHERE "guildId" = ${guildId} AND "action" = ${'message.created'}`,
    ),
    prisma.$queryRaw<Array<{ joined: number | null; left: number | null }>>(
      Prisma.sql`SELECT
                 SUM(CASE WHEN "action" = ${'member.joined'} THEN 1 ELSE 0 END) AS joined,
                 SUM(CASE WHEN "action" = ${'member.left'} THEN 1 ELSE 0 END) AS left
                 FROM "audit_logs"
                 WHERE "guildId" = ${guildId} AND "action" IN (${'member.joined'}, ${'member.left'}) AND "createdAt" >= ${since}`,
    ),
    // Top membres SUR LA FENÊTRE : l'audit porte l'auteur de chaque
    // message humain. memberActivity est un cumul depuis toujours
    // (il faisait annoncer 9 messages là où la fenêtre en compte 7).
    prisma.$queryRaw<Array<{ userId: string; messages: number }>>(
      Prisma.sql`SELECT "actorId" AS userId, COUNT(*) AS messages
                         FROM "audit_logs"
                         WHERE "guildId" = ${guildId} AND "action" = ${'message.created'} AND "createdAt" >= ${since} AND "actorId" IS NOT NULL
                         GROUP BY "actorId" ORDER BY messages DESC, "actorId" ASC LIMIT 5`,
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

  const dayRows = perDay.filter((row): row is { day: string; messages: number } => row.day !== null);
  const totalMessages = dayRows.reduce((sum, row) => sum + Number(row.messages), 0);
  const coverageSinceMs = coverage[0]?.since == null ? null : Number(coverage[0].since);
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
