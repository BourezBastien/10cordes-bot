import type { HttpGuard } from '@spraxium/http';
import type { Context } from 'hono';
import { Client } from 'discord.js';
import { guildAccessContext, guildManagerPolicy } from '../../core/security/access-policy';
import { getValidatedEnv } from '../env.accessor';
import { getAuth } from '../auth.instance';

interface CacheEntry {
  expiresAt: number;
  allowed: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1_000;

/**
 * Vérifie que l'utilisateur de la session a `ManageGuild` ou `Administrator`
 * sur le serveur ciblé par le paramètre de route `guildId`. Résultat en cache 5 min.
 * Nécessite `SessionGuard` en amont (elle pose la session dans le contexte Hono).
 */
export class GuildAccessGuard implements HttpGuard {
  private static readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly client: Client) {}

  async canActivate(ctx: Context): Promise<boolean> {
    const session = await this.resolveSession(ctx);
    if (!session) return false;

    const guildId = ctx.req.param('guildId');
    if (!guildId) return false;
    const userId = session.user.id;
    const cacheKey = `${guildId}:${userId}`;

    const cached = GuildAccessGuard.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.allowed;

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;

    // Seul un membre qui gère le serveur (ManageGuild, Administrator ou
    // propriétaire) peut lire sa configuration : décision de GuildManagerPolicy.
    const allowed = guild !== null && member !== null && guildManagerPolicy.isAuthorized(guildAccessContext(guild, userId, member));

    GuildAccessGuard.cache.set(cacheKey, { allowed, expiresAt: Date.now() + CACHE_TTL_MS });
    return allowed;
  }

  private async resolveSession(ctx: Context) {
    const existing = ctx.get('session') as { user: { id: string } } | undefined;
    if (existing) return existing;
    const auth = getAuth(getValidatedEnv());
    const session = await auth.api.getSession({ headers: ctx.req.raw.headers });
    if (session) ctx.set('session', session);
    return session;
  }
}
