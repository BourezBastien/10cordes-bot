import { describe, expect, it } from 'vitest';
import { PermissionsBitField } from 'discord.js';
import type { Guild, GuildBasedChannel, GuildChannel, GuildMember } from 'discord.js';
import type { PermissionName } from './permission-name';
import {
  accessContextFromNames,
  ForbiddenDomainError,
  GuildAccessContext,
  GuildAdminPolicy,
  GuildManagerPolicy,
  guildAccessContext,
  interactionAccessContext,
} from './access-policy';
import { adminOpPolicy, requiredPermissionFor } from './admin-op.policy';
import { BotMissingPermissionError, BotPermissionPolicy, botPermissionPolicy } from './bot-permission.policy';
import { MemberPermissionPolicy } from './member-permission.policy';
import { isAssignablePermissionName } from './permission-name';
import { permissionNamesPolicy } from './permission-names.policy';

/**
 * Policies de sécurité : tout contrôle de permission Discord du bot passe
 * par ici. Ces tests fixent le contrat (formes « nom » et « bitflag », Administrator
 * qui ouvre tout, membre absent du cache, propriétaire du serveur).
 */

const GUILD_ID = '1550000000000000001';
const OWNER_ID = '1550000000000000002';

/** Membre factice muni de permissions discord.js réelles. */
function member(flags: PermissionName[], id = '1550000000000000003'): GuildMember {
  return { id, permissions: new PermissionsBitField(flags) } as unknown as GuildMember;
}

/** Serveur factice : propriétaire, et le bot comme membre. */
function guild(meFlags: PermissionName[] | null, ownerId = OWNER_ID): Guild {
  const me = meFlags === null ? null : member(meFlags, '1550000000000000009');
  return { id: GUILD_ID, ownerId, members: { me } } as unknown as Guild;
}

describe('GuildAdminPolicy · propriétaire ou Administrator', () => {
  const policy = new GuildAdminPolicy();

  it('accepte le propriétaire du serveur, même sans permission', () => {
    const ctx = guildAccessContext(guild(null), OWNER_ID, member([]));
    expect(policy.isAuthorized(ctx)).toBe(true);
    expect(policy.isOwner(ctx)).toBe(true);
  });

  it('accepte Administrator sous sa forme NOM (permissions.toArray())', () => {
    const ctx = guildAccessContext(guild(null), '1550000000000000004', member(['Administrator']));
    expect(ctx.permissions).toEqual(['Administrator']);
    expect(policy.isAuthorized(ctx)).toBe(true);
  });

  it('accepte Administrator sous sa forme BITFLAG (valeur 8)', () => {
    const ctx: GuildAccessContext = { userId: '1550000000000000004', guildOwnerId: OWNER_ID, permissions: ['8'] };
    expect(policy.isAuthorized(ctx)).toBe(true);
  });

  it('refuse un membre qui a seulement ManageGuild', () => {
    const ctx = guildAccessContext(guild(null), '1550000000000000004', member(['ManageGuild']));
    expect(policy.isAuthorized(ctx)).toBe(false);
    expect(() => policy.assertAuthorized(ctx)).toThrow(ForbiddenDomainError);
    try {
      policy.assertAuthorized(ctx);
    } catch (error) {
      expect((error as ForbiddenDomainError).policy).toBe('GuildAdmin');
      expect((error as Error).message).toContain('administrateur');
    }
  });

  it('refuse un membre absent du cache', () => {
    expect(policy.isAuthorized(guildAccessContext(guild(null), '1550000000000000004', null))).toBe(false);
  });
});

describe('GuildManagerPolicy · ManageGuild, Administrator ou propriétaire', () => {
  const policy = new GuildManagerPolicy();

  it('accepte ManageGuild, Administrator et le propriétaire', () => {
    expect(policy.isAuthorized(guildAccessContext(guild(null), '1', member(['ManageGuild'])))).toBe(true);
    expect(policy.isAuthorized(guildAccessContext(guild(null), '1', member(['Administrator'])))).toBe(true);
    expect(policy.isAuthorized(guildAccessContext(guild(null), OWNER_ID, member([])))).toBe(true);
    expect(policy.isAuthorized({ userId: '1', guildOwnerId: OWNER_ID, permissions: ['32'] })).toBe(true);
  });

  it('refuse toute autre permission', () => {
    expect(policy.isAuthorized(guildAccessContext(guild(null), '1', member(['ManageChannels', 'KickMembers'])))).toBe(false);
    expect(() => policy.assertAuthorized(guildAccessContext(guild(null), '1', member([])))).toThrow(/Gérer le serveur/u);
  });
});

describe('BotPermissionPolicy · permissions du bot lui-même', () => {
  const policy = new BotPermissionPolicy();

  it('dans le serveur : flag présent, Administrator, ou rien', () => {
    expect(policy.canInGuild(guild(['ManageChannels']), 'ManageChannels')).toBe(true);
    expect(policy.canInGuild(guild(['Administrator']), 'BanMembers')).toBe(true);
    expect(policy.canInGuild(guild(['ManageRoles']), 'ManageChannels')).toBe(false);
    expect(policy.canInGuild(guild(null), 'ManageChannels')).toBe(false);
  });

  it('lève une erreur domaine actionnable', () => {
    expect(() => policy.assertCanInGuild(guild([]), 'ManageRoles')).toThrow(BotMissingPermissionError);
    expect(policy.refusal('ManageRoles')).toBe('Le bot n\u0027a pas la permission ManageRoles sur ce serveur.');
    expect(policy.refusal('SendMessages', 'channel')).toBe('Le bot n\u0027a pas la permission SendMessages dans ce salon.');
  });

  it('dans un salon : exige TOUTES les permissions listées', () => {
    const channelWith = (flags: PermissionName[]) =>
      ({
        guild: guild([]),
        permissionsFor: () => new PermissionsBitField(flags),
      }) as unknown as GuildBasedChannel;
    expect(policy.canAllInChannel(channelWith(['ViewChannel', 'ReadMessageHistory']), ['ViewChannel', 'ReadMessageHistory'])).toBe(true);
    expect(policy.canAllInChannel(channelWith(['ViewChannel']), ['ViewChannel', 'ReadMessageHistory'])).toBe(false);
    expect(policy.canAllInChannel(null, ['SendMessages'])).toBe(false);
  });

  it('lit l\u0027overwrite @everyone (état d\u0027un salon, pas une décision)', () => {
    const channel = (deny: PermissionName[]) =>
      ({
        guildId: GUILD_ID,
        permissionOverwrites: { cache: new Map([[GUILD_ID, { deny: new PermissionsBitField(deny) }]]) },
      }) as unknown as GuildChannel;
    expect(policy.isDeniedToEveryone(channel(['SendMessages']), 'SendMessages')).toBe(true);
    expect(policy.isDeniedToEveryone(channel(['ManageMessages']), 'SendMessages')).toBe(false);
    expect(policy.isDeniedToEveryone(channel([]), 'SendMessages')).toBe(false);
    expect(policy.isDeniedToEveryone(null, 'SendMessages')).toBe(false);
  });
});

describe('MemberPermissionPolicy · permissions d\u0027un membre', () => {
  const policy = new MemberPermissionPolicy();

  it('Administrator ouvre toutes les permissions', () => {
    expect(policy.isAdmin(member(['Administrator']))).toBe(true);
    expect(policy.has(member(['Administrator']), 'BanMembers')).toBe(true);
  });

  it('la permission doit être présente sinon, et un membre absent n\u0027a rien', () => {
    expect(policy.has(member(['ModerateMembers']), 'ModerateMembers')).toBe(true);
    expect(policy.has(member(['ModerateMembers']), 'BanMembers')).toBe(false);
    expect(policy.has(null, 'ManageGuild')).toBe(false);
    expect(policy.hasAny(member(['KickMembers']), ['BanMembers', 'KickMembers'])).toBe(true);
  });
});

describe('AdminOpPolicy · opérations d\u0027administration', () => {
  it('exige la permission propre à chaque op, ManageGuild par défaut', () => {
    expect(requiredPermissionFor('channel.delete')).toBe('ManageChannels');
    expect(requiredPermissionFor('role.delete')).toBe('ManageRoles');
    expect(requiredPermissionFor('member.ban')).toBe('BanMembers');
    expect(requiredPermissionFor('member.timeout')).toBe('ModerateMembers');
    expect(requiredPermissionFor('member.kick')).toBe('KickMembers');
  });

  it('le propriétaire passe toute op, un modérateur ne passe que la sienne', () => {
    const server = guild(null);
    expect(adminOpPolicy.isRequesterAllowed(server, member([]), OWNER_ID, 'channel.delete')).toBe(true);
    expect(adminOpPolicy.isRequesterAllowed(server, member(['ManageChannels']), '1', 'channel.delete')).toBe(true);
    expect(adminOpPolicy.isRequesterAllowed(server, member(['ManageChannels']), '1', 'role.delete')).toBe(false);
    expect(adminOpPolicy.isRequesterAllowed(server, null, '1', 'role.delete')).toBe(false);
    expect(adminOpPolicy.isRequesterAllowed(server, member(['Administrator']), '1', 'member.ban')).toBe(true);
  });
});

describe('isAssignablePermissionName · flags acceptés dans un overwrite', () => {
  it('accepte les permissions réelles et refuse Administrator et les propriétés héritées', () => {
    expect(isAssignablePermissionName('ViewChannel')).toBe(true);
    expect(isAssignablePermissionName('SendMessages')).toBe(true);
    expect(isAssignablePermissionName('Administrator')).toBe(false);
    expect(isAssignablePermissionName('toString')).toBe(false);
    expect(isAssignablePermissionName('constructor')).toBe(false);
    expect(isAssignablePermissionName('__proto__')).toBe(false);
    expect(isAssignablePermissionName('Existepas')).toBe(false);
  });
});

describe('PermissionNamesPolicy · listes de noms (ToolRunContext.permissions)', () => {
  it('Administrator ouvre tout, un nom inconnu n\u0027est jamais accordé', () => {
    expect(permissionNamesPolicy.isAdmin(['Administrator'])).toBe(true);
    expect(permissionNamesPolicy.isAdmin(['ManageGuild'])).toBe(false);
    expect(permissionNamesPolicy.has(['ManageGuild'], 'ManageGuild')).toBe(true);
    expect(permissionNamesPolicy.has(['ManageGuild'], 'ManageChannels')).toBe(false);
    expect(permissionNamesPolicy.has(['Administrator'], 'ExistePas')).toBe(true);
    expect(permissionNamesPolicy.has(['ManageGuild'], 'ExistePas')).toBe(false);
  });

  it('hasAny exige une seule permission, hasAll les exige toutes', () => {
    expect(permissionNamesPolicy.hasAny(['ManageGuild'], ['ManageGuild', 'Administrator'])).toBe(true);
    expect(permissionNamesPolicy.hasAny([], ['ManageGuild', 'Administrator'])).toBe(false);
    expect(permissionNamesPolicy.hasAll(['ManageGuild', 'ManageRoles'], ['ManageGuild', 'ManageRoles'])).toBe(true);
    expect(permissionNamesPolicy.hasAll(['ManageGuild'], ['ManageGuild', 'ManageRoles'])).toBe(false);
    expect(permissionNamesPolicy.hasAll(['Administrator'], ['ManageGuild', 'ManageRoles'])).toBe(true);
  });

  it('missing liste les permissions absentes, vide quand tout est accordé (ou administrateur)', () => {
    expect(permissionNamesPolicy.missing(['ManageGuild'], ['ManageGuild', 'ManageRoles'])).toEqual(['ManageRoles']);
    expect(permissionNamesPolicy.missing(['ManageGuild'], ['ManageGuild'])).toEqual([]);
    expect(permissionNamesPolicy.missing([], [])).toEqual([]);
    expect(permissionNamesPolicy.missing(['Administrator'], ['ManageRoles', 'BanMembers'])).toEqual([]);
  });
});

describe('MemberPermissionPolicy · rôles et permissions chargées d\u0027une définition', () => {
  const policy = new MemberPermissionPolicy();
  const ROLE = '1550000000000000021';
  const OTHER_ROLE = '1550000000000000022';
  /** Cache de rôles factice, avec le hasAny de discord.js. */
  const roleCache = (): Map<string, unknown> => {
    const cache = new Map<string, unknown>([[ROLE, {}]]);
    Object.assign(cache, { hasAny: (...ids: string[]) => ids.some((id) => cache.has(id)) });
    return cache;
  };
  const withRole = (): GuildMember => ({ roles: { cache: roleCache() } }) as unknown as GuildMember;

  it('hasRole et hasAnyRole lisent les rôles du membre ; un membre absent n\u0027en a aucun', () => {
    expect(policy.hasRole(withRole(), ROLE)).toBe(true);
    expect(policy.hasRole(withRole(), OTHER_ROLE)).toBe(false);
    expect(policy.hasRole(null, ROLE)).toBe(false);
    expect(policy.hasAnyRole(withRole(), [OTHER_ROLE, ROLE])).toBe(true);
    expect(policy.hasAnyRole(withRole(), [OTHER_ROLE])).toBe(false);
    expect(policy.hasAnyRole(null, [ROLE])).toBe(false);
  });

  it('hasAllNames exige toutes les permissions demandées, sauf administrateur', () => {
    expect(policy.hasAllNames(member(['ManageGuild', 'ManageRoles']), ['ManageGuild', 'ManageRoles'])).toBe(true);
    expect(policy.hasAllNames(member(['ManageGuild']), ['ManageGuild', 'ManageRoles'])).toBe(false);
    expect(policy.hasAllNames(member(['ManageGuild']), ['ManageGuild', 'ExistePas'])).toBe(false);
    expect(policy.hasAllNames(member(['Administrator']), ['BanMembers', 'ExistePas'])).toBe(true);
    expect(policy.hasAllNames(null, ['ManageGuild'])).toBe(false);
  });
});

describe('contextes d\u0027accès sans GuildMember résolu', () => {
  it('accessContextFromNames copie des noms déjà résolus', () => {
    const names = ['ManageGuild'];
    const ctx = accessContextFromNames(guild(null), '1', names);
    expect(ctx).toEqual({ userId: '1', guildOwnerId: OWNER_ID, permissions: ['ManageGuild'] });
    names.push('Administrator');
    expect(ctx.permissions).toEqual(['ManageGuild']);
  });

  it('interactionAccessContext lit memberPermissions, null hors serveur', () => {
    expect(interactionAccessContext({ user: { id: '1' }, guild: null })).toBeNull();
    expect(
      interactionAccessContext({ user: { id: '1' }, guild: { ownerId: OWNER_ID }, memberPermissions: { toArray: () => ['ManageGuild'] } }),
    ).toEqual({ userId: '1', guildOwnerId: OWNER_ID, permissions: ['ManageGuild'] });
    expect(interactionAccessContext({ user: { id: '1' }, guild: { ownerId: OWNER_ID } })).toEqual({
      userId: '1',
      guildOwnerId: OWNER_ID,
      permissions: [],
    });
  });
});

describe('BotPermissionPolicy.isRoleAboveBot · hiérarchie des rôles', () => {
  const serverWithBot = (highest: number | null): Guild =>
    ({
      id: GUILD_ID,
      ownerId: OWNER_ID,
      members: { me: highest === null ? null : { roles: { highest: { position: highest } } } },
    }) as unknown as Guild;

  it('un rôle au niveau ou au-dessus du plus haut rôle du bot est hors de portée', () => {
    expect(botPermissionPolicy.isRoleAboveBot(serverWithBot(5), { position: 5 })).toBe(true);
    expect(botPermissionPolicy.isRoleAboveBot(serverWithBot(5), { position: 6 })).toBe(true);
    expect(botPermissionPolicy.isRoleAboveBot(serverWithBot(5), { position: 4 })).toBe(false);
    expect(botPermissionPolicy.isRoleAboveBot(serverWithBot(null), { position: 1 })).toBe(true);
  });
});
