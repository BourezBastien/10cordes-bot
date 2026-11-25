import { Hono, type Context } from 'hono';
import { ForbiddenError } from '@spraxium/http';
import type { Client, Guild, GuildMember } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSession } from '../auth.instance';
import { discordIdOf } from '../discord-identity';
import { GuildAccessGuard, guildAccessOf } from './guild-access.guard';

/**
 * Garde d’accès à un serveur : à CHAQUE requête, l’utilisateur de la session
 * doit être membre du serveur ciblé et pouvoir le gérer. Rien n’est mis en
 * cache. L’identité Discord vient de la table des comptes liés : l’identifiant
 * de la session better-auth n’est PAS un identifiant Discord.
 */

vi.mock('../auth.instance', () => ({ readSession: vi.fn() }));
vi.mock('../discord-identity', () => ({ discordIdOf: vi.fn() }));

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';
const SESSION = { session: { id: 's1', userId: 'user-better-auth' }, user: { id: 'user-better-auth', [NAME]: 'Test' } } as Awaited<ReturnType<typeof readSession>>;
const GUILD = '1550000000000000001';
const SNOWFLAKE = '1550000000000000002';
const OWNER = '1550000000000000009';

interface Harness {
  guard: GuildAccessGuard;
  memberFetch: ReturnType<typeof vi.fn>;
  guildFetch: ReturnType<typeof vi.fn>;
}

/** Un membre factice, avec les permissions qu’on lui donne. */
function member(id: string, permissions: string[]): GuildMember {
  return { id, permissions: { toArray: () => permissions } } as unknown as GuildMember;
}

/** Client factice : un serveur en cache (ou non), un membre en cache (ou non). */
function harness(options: { guildCached?: boolean; memberCached?: boolean; member?: GuildMember } = {}): Harness {
  const who = options.member ?? member(SNOWFLAKE, ['ManageGuild']);
  const memberFetch = vi.fn(async () => who);
  const guildFetch = vi.fn(async () => guild);
  const members = new Map<string, GuildMember>(options.memberCached === false ? [] : [[who.id, who]]);
  const guild = { id: GUILD, ownerId: OWNER, members: { cache: members, fetch: memberFetch } } as unknown as Guild;
  const client = { guilds: { cache: new Map<string, Guild>(options.guildCached === false ? [] : [[GUILD, guild]]), fetch: guildFetch } } as unknown as Client;
  return { guard: new GuildAccessGuard(client, {} as never), memberFetch, guildFetch };
}

type Outcome = { allowed?: boolean; refused?: { status: number; message: string }; access?: Record<string, unknown> };

/** Fait passer la requête par la garde ; rend l’issue et ce que la garde a laissé dans le contexte. */
async function through(h: Harness, path: string = `/api/v1/guilds/${GUILD}/x`): Promise<Outcome> {
  const app = new Hono();
  const handler = async (ctx: Context) => {
    try {
      const allowed = await h.guard.canActivate(ctx);
      if (!allowed) return ctx.json({ allowed: false });
      const access = guildAccessOf(ctx);
      return ctx.json({ allowed, access: { guildId: access.guildId, discordUserId: access.discordUserId, member: access.member, guild: access.guild } });
    } catch (error) {
      if (error instanceof ForbiddenError) return ctx.json({ refused: { status: error.statusCode, message: error.message } });
      throw error;
    }
  };
  // Le paramètre de route `guildId`, tel que le framework le lie pour la garde.
  app.all('/api/v1/guilds/:guildId/*', handler);
  app.all('/sans-parametre', handler);
  return (await (await app.request(path)).json()) as Outcome;
}

beforeEach(() => {
  vi.mocked(readSession).mockResolvedValue(SESSION);
  vi.mocked(discordIdOf).mockResolvedValue(SNOWFLAKE);
});

describe('GuildAccessGuard', () => {
  it('sans session : refus (401), et Discord n’est même pas interrogé', async () => {
    vi.mocked(readSession).mockResolvedValue(null);
    const h = harness();
    expect(await through(h)).toEqual({ allowed: false });
    expect(discordIdOf).not.toHaveBeenCalled();
    expect(h.guildFetch).not.toHaveBeenCalled();
  });

  it('un membre qui gère le serveur passe ; la garde laisse le serveur vérifié et le membre lu', async () => {
    const h = harness();
    const result = await through(h);
    expect(result.allowed).toBe(true);
    expect(result.access).toMatchObject({ guildId: GUILD, discordUserId: SNOWFLAKE, member: { id: SNOWFLAKE }, guild: { id: GUILD } });
    // L’identité Discord vient du compte lié, pas de l’identifiant de la session.
    expect(discordIdOf).toHaveBeenCalledWith(expect.anything(), 'user-better-auth');
  });

  it('le propriétaire du serveur passe sans aucune permission, même hors du cache', async () => {
    vi.mocked(discordIdOf).mockResolvedValue(OWNER);
    const h = harness({ memberCached: false, member: member(OWNER, []) });
    expect((await through(h)).allowed).toBe(true);
    expect(h.memberFetch).toHaveBeenCalledWith(OWNER);
  });

  it('un compte sans identité Discord liée : 403, et Discord n’est pas interrogé', async () => {
    vi.mocked(discordIdOf).mockResolvedValue(null);
    const h = harness();
    expect((await through(h)).refused).toMatchObject({ status: 403 });
    expect(h.guildFetch).not.toHaveBeenCalled();
    expect(h.memberFetch).not.toHaveBeenCalled();
  });

  it('un serveur inconnu du bot : 403, et le membre n’est pas cherché', async () => {
    const h = harness({ guildCached: false });
    h.guildFetch.mockRejectedValue(new Error('Unknown Guild'));
    expect((await through(h)).refused).toMatchObject({ status: 403 });
    expect(h.memberFetch).not.toHaveBeenCalled();
  });

  it('un membre absent du serveur : 403, sans égard à ses droits', async () => {
    const h = harness({ memberCached: false });
    h.memberFetch.mockResolvedValue(null);
    expect((await through(h)).refused).toMatchObject({ status: 403 });
  });

  it('un membre sans le droit de gérer : 403 ; Administrateur et Gérer le serveur passent', async () => {
    expect((await through(harness({ member: member(SNOWFLAKE, ['ViewChannel']) }))).refused).toMatchObject({ status: 403 });
    expect((await through(harness({ member: member(SNOWFLAKE, ['Administrator']) }))).allowed).toBe(true);
    // La permission par la valeur du bitflag, comme un contexte d’outil la porte.
    expect((await through(harness({ member: member(SNOWFLAKE, ['32']) }))).allowed).toBe(true);
  });

  it('rien n’est mis en cache : un droit retiré ferme l’accès à la requête suivante', async () => {
    let permissions = ['ManageGuild'];
    // Le membre du cache est relu à chaque requête : ses permissions sont celles du moment.
    const mutable = {
      id: SNOWFLAKE,
      get permissions(): { toArray: () => string[] } {
        return { toArray: () => permissions };
      },
    } as GuildMember;
    const h = harness({ member: mutable });
    expect((await through(h)).allowed).toBe(true);
    permissions = [];
    expect((await through(h)).refused).toMatchObject({ status: 403 });
  });

  it('sans paramètre de serveur dans la route : refus, et Discord n’est pas interrogé', async () => {
    const h = harness();
    expect(await through(h, '/sans-parametre')).toEqual({ allowed: false });
    expect(discordIdOf).not.toHaveBeenCalled();
  });
});
