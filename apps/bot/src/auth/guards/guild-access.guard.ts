import { ForbiddenError, type HttpGuard } from '@spraxium/http';
import type { Context } from 'hono';
import { Client, type Guild, type GuildMember } from 'discord.js';
import { guildAccessContext, guildManagerPolicy } from '../../core/security/access-policy';
import { PrismaService } from '../../modules/database/prisma.service';
import { discordIdOf } from '../discord-identity';
import { sessionOf } from './session.guard';

/** Membres déjà lus, pour les handlers en aval : plus de relecture Discord. */
export interface GuildAccess {
  guildId: string;
  discordUserId: string;
  guild: Guild;
  member: GuildMember;
}

const GUILD_KEY = 'guildAccess';

/**
 * Vérifie, À CHAQUE requête, que l'utilisateur de la session est membre du
 * serveur ciblé (paramètre de route `guildId`) et peut en gérer la
 * configuration (décision de `GuildManagerPolicy` : Gérer le serveur,
 * Administrateur ou propriétaire). Rien n'est mis en cache : un rôle retiré
 * ou un membre parti ferme l'accès à la requête suivante.
 *
 * Nécessite `SessionGuard` en amont. Sans session : refus (401). Membre
 * absent ou sans droit : `ForbiddenError` (403).
 */
export class GuildAccessGuard implements HttpGuard {
  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: Context): Promise<boolean> {
    const session = await sessionOf(ctx);
    if (!session) return false;
    const guildId = ctx.req.param('guildId');
    if (!guildId) return false;

    const discordUserId = await discordIdOf(this.prisma, session.user.id);
    if (!discordUserId) throw new ForbiddenError('Compte Discord lié introuvable pour cette session.');

    const guild = this.client.guilds.cache.get(guildId) ?? (await this.client.guilds.fetch(guildId).catch(() => null));
    if (!guild) throw new ForbiddenError('Serveur introuvable pour le bot.');

    const member = guild.members.cache.get(discordUserId) ?? (await guild.members.fetch(discordUserId).catch(() => null));
    if (!member) throw new ForbiddenError('Tu n\u0027es pas membre de ce serveur.');

    if (!guildManagerPolicy.isAuthorized(guildAccessContext(guild, discordUserId, member))) {
      throw new ForbiddenError('Droit de gérer le serveur requis (Gérer le serveur, Administrateur ou propriétaire).');
    }

    ctx.set(GUILD_KEY, { guildId, discordUserId, guild, member } satisfies GuildAccess);
    return true;
  }
}

/** Ce que la garde a vérifié pour cette requête. */
export function guildAccessOf(ctx: Context): GuildAccess {
  return ctx.get(GUILD_KEY) as GuildAccess;
}
