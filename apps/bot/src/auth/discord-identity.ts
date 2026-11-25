import type { PrismaService } from '../modules/database/prisma.service';

/**
 * Identité Discord d'une session. L'identifiant de l'utilisateur better-auth
 * (`session.user.id`) est généré par la bibliothèque à la connexion : ce n'est
 * PAS un identifiant Discord. Le snowflake est rangé dans la table des comptes
 * liés (`account.accountId`, fournisseur `discord`). Toute recherche de
 * membre à partir d'une session passe par ici.
 */
export async function discordIdOf(prisma: PrismaService, sessionUserId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId: sessionUserId, providerId: 'discord' },
    select: { accountId: true },
  });
  return /^\d{15,21}$/u.test(account?.accountId ?? '') ? (account?.accountId ?? null) : null;
}
