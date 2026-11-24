import { describe, expect, it } from 'vitest';
import { PermissionsBitField } from 'discord.js';
import type { BotTool } from '@10cordes/shared';
import type { Guild, GuildBasedChannel, GuildMember } from 'discord.js';
import { actionPlanPolicy } from './action-plan.policy';
import { channelVisibilityPolicy, ChannelVisibilityPolicy } from './channel-visibility.policy';
import { MemberPermissionPolicy, memberPermissionPolicy } from './member-permission.policy';
import type { PermissionName } from './permission-name';

/**
 * Hiérarchie, visibilité d'un membre et plans d'action. Ce que ces tests
 * fixent : un membre n'agit que sur une cible placée sous lui, ne touche que
 * les rôles placés sous le sien, n'accorde que les permissions qu'il détient,
 * ne voit que les salons que Discord lui montre (overwrites compris), et une
 * action d'un plan est revérifiée à l'instant du clic.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const ACTOR = '1550000000000000003';
const TARGET = '1550000000000000004';

const guild = { id: GUILD, ownerId: OWNER } as unknown as Guild;

/** Membre factice : permissions réelles et position de son rôle le plus haut. */
function member(id: string, flags: PermissionName[] = [], highest = 0): GuildMember {
  return {
    id,
    guild,
    permissions: new PermissionsBitField(flags),
    roles: { highest: { position: highest } },
  } as unknown as GuildMember;
}

/** Salon factice : visible des membres listés (via les overwrites). */
function channel(visible: string[]): GuildBasedChannel {
  return {
    permissionsFor: (who: GuildMember) => new PermissionsBitField(visible.includes(who.id) ? ['ViewChannel'] : []),
  } as unknown as GuildBasedChannel;
}

describe('MemberPermissionPolicy · permission dans un salon', () => {
  it('suit les overwrites du salon, pas seulement les permissions du serveur', () => {
    const moderator = member(ACTOR, ['ManageMessages'], 1);
    const staffRoom = channel([]);
    const publicRoom = channel([ACTOR]);
    expect(memberPermissionPolicy.hasIn(moderator, staffRoom, 'ViewChannel')).toBe(false);
    expect(memberPermissionPolicy.hasIn(moderator, publicRoom, 'ViewChannel')).toBe(true);
  });

  it('le propriétaire voit tout, même sans le bit Administrator ; un administrateur aussi', () => {
    expect(memberPermissionPolicy.hasIn(member(OWNER, [], 0), channel([]), 'ViewChannel')).toBe(true);
    expect(memberPermissionPolicy.hasIn(member(ACTOR, ['Administrator'], 0), channel([]), 'ViewChannel')).toBe(true);
  });

  it('sans membre ou sans salon, rien', () => {
    expect(memberPermissionPolicy.hasIn(null, channel([ACTOR]), 'ViewChannel')).toBe(false);
    expect(memberPermissionPolicy.hasIn(member(ACTOR), null, 'ViewChannel')).toBe(false);
  });
});

describe('MemberPermissionPolicy · agir sur une cible', () => {
  const policy = new MemberPermissionPolicy();

  it('un membre agit sur une cible strictement au-dessous de lui, jamais à hauteur égale ni au-dessus', () => {
    const actor = member(ACTOR, ['ModerateMembers'], 5);
    expect(policy.canActOn(actor, member(TARGET, [], 4))).toBe(true);
    expect(policy.canActOn(actor, member(TARGET, [], 5))).toBe(false);
    expect(policy.canActOn(actor, member(TARGET, [], 9))).toBe(false);
  });

  it('jamais sur le propriétaire du serveur, sauf soi-même en tant que propriétaire', () => {
    expect(policy.canActOn(member(ACTOR, ['Administrator'], 99), member(OWNER, [], 0))).toBe(false);
    expect(policy.canActOn(member(OWNER, [], 0), member(TARGET, [], 0))).toBe(true);
  });

  it('jamais sur soi-même, sauf quand la règle de l\u0027action l\u0027autorise (se donner un rôle)', () => {
    const actor = member(ACTOR, ['ManageRoles'], 5);
    expect(policy.canActOn(actor, actor)).toBe(false);
    expect(policy.canActOn(actor, actor, { allowSelf: true })).toBe(true);
    expect(policy.canActOn(member(OWNER), member(OWNER))).toBe(false);
  });

  it('une cible absente du serveur n\u0027est permise que si l\u0027action l\u0027accepte (retirer un ban)', () => {
    const actor = member(ACTOR, ['BanMembers'], 5);
    expect(policy.canActOn(actor, null)).toBe(false);
    expect(policy.canActOn(actor, null, { allowAbsent: true })).toBe(true);
  });
});

describe('MemberPermissionPolicy · gérer un rôle', () => {
  const policy = new MemberPermissionPolicy();

  it('un rôle strictement au-dessous du sien, oui ; à hauteur égale ou au-dessus, non', () => {
    const actor = member(ACTOR, ['ManageRoles'], 5);
    expect(policy.canManageRole(actor, { id: '10', position: 4, managed: false })).toBe(true);
    expect(policy.canManageRole(actor, { id: '10', position: 5, managed: false })).toBe(false);
    expect(policy.canManageRole(actor, { id: '10', position: 6, managed: false })).toBe(false);
  });

  it('jamais un rôle géré par une intégration, ni @everyone, ni un rôle absent ; le propriétaire peut tous', () => {
    const actor = member(ACTOR, ['ManageRoles'], 5);
    expect(policy.canManageRole(actor, { id: '10', position: 1, managed: true })).toBe(false);
    expect(policy.canManageRole(actor, { id: GUILD, position: 0, managed: false })).toBe(false);
    expect(policy.canManageRole(actor, null)).toBe(false);
    expect(policy.canManageRole(member(OWNER, [], 0), { id: '10', position: 40, managed: false })).toBe(true);
  });
});

describe('MemberPermissionPolicy · n\u0027accorder que ce que l\u0027on détient', () => {
  const policy = new MemberPermissionPolicy();

  it('un membre accorde une permission seulement s\u0027il la détient ; l\u0027administrateur et le propriétaire accordent tout', () => {
    const moderator = member(ACTOR, ['ManageRoles', 'ManageMessages'], 5);
    expect(policy.grantsOnly(moderator, ['ManageMessages'])).toBe(true);
    expect(policy.grantsOnly(moderator, ['ManageMessages', 'BanMembers'])).toBe(false);
    expect(policy.grantsOnly(member(ACTOR, ['Administrator'], 0), ['BanMembers'])).toBe(true);
    expect(policy.grantsOnly(member(OWNER, [], 0), ['BanMembers'])).toBe(true);
  });
});

describe('ChannelVisibilityPolicy · liste de salons', () => {
  const policy = new ChannelVisibilityPolicy();

  it('un membre ne reçoit que les salons qu\u0027il voit ; les autres ne sont ni nommés ni comptés', () => {
    const rooms = [
      { id: '20', name: 'général', room: channel([ACTOR, TARGET]) },
      { id: '21', name: 'staff-only', room: channel([TARGET]) },
      { id: '22', name: 'archives-privées', room: channel([]) },
    ];
    expect(policy.visibleOnly(member(ACTOR), rooms, (entry) => entry.room).map((entry) => entry.name)).toEqual(['général']);
    expect(policy.visibleOnly(member(TARGET), rooms, (entry) => entry.room).map((entry) => entry.name)).toEqual(['général', 'staff-only']);
  });

  it('un administrateur, le propriétaire, puis un membre inconnu : tout, tout, rien', () => {
    const rooms = [{ id: '21', room: channel([]) }];
    expect(policy.visibleOnly(member(ACTOR, ['Administrator']), rooms, (entry) => entry.room)).toHaveLength(1);
    expect(policy.visibleOnly(member(OWNER), rooms, (entry) => entry.room)).toHaveLength(1);
    expect(policy.visibleOnly(null, rooms, (entry) => entry.room)).toHaveLength(0);
  });

  it('le singleton exporté est bien une instance de la policy', () => {
    expect(channelVisibilityPolicy).toBeInstanceOf(ChannelVisibilityPolicy);
  });

  it('sans membre résolvable (webhook du rig E2E) : tout avec Administrator, rien sinon', () => {
    // Régression du 24/11 : le filtre répondait « 0 salons » au webhook du rig, qui parle en staff.
    expect(policy.visibleWithoutMember(['Administrator'])).toBe(true);
    expect(policy.visibleWithoutMember(['ManageChannels', 'ManageGuild'])).toBe(false);
    expect(policy.visibleWithoutMember([])).toBe(false);
  });
});

/** Un serveur avec ses caches : membres, rôles, salons. */
function world() {
  const members = new Map<string, GuildMember>();
  const roles = new Map<string, { id: string; position: number; managed: boolean }>();
  const channels = new Map<string, GuildBasedChannel>();
  const guild = { id: GUILD, ownerId: OWNER, members: { cache: members }, roles: { cache: roles }, channels: { cache: channels } } as unknown as Guild;
  const addMember = (id: string, flags: PermissionName[] = [], highest = 0, suspended = false): GuildMember => {
    const created = {
      id,
      guild,
      permissions: new PermissionsBitField(flags),
      roles: { highest: { position: highest } },
      isCommunicationDisabled: () => suspended,
    } as unknown as GuildMember;
    members.set(id, created);
    return created;
  };
  const addRole = (id: string, position: number, managed = false): void => {
    roles.set(id, { id, position, managed });
  };
  const addChannel = (id: string, visible: string[] = [], allowed: PermissionName[] = []): GuildBasedChannel => {
    const created = {
      permissionsFor: (who: GuildMember) => new PermissionsBitField(visible.includes(who.id) ? ['ViewChannel', ...allowed] : []),
    } as unknown as GuildBasedChannel;
    channels.set(id, created);
    return created;
  };
  return { guild, addMember, addRole, addChannel };
}

describe('ActionPlanPolicy · revalidation d\u0027une action au clic', () => {
  const policy = actionPlanPolicy;
  const tool = (permissions: string[]): BotTool => ({ permissions } as unknown as BotTool);

  it('seul l\u0027auteur du plan l\u0027applique ; un plan expire à son échéance, pas avant', () => {
    expect(policy.isRequester({ requesterId: ACTOR }, ACTOR)).toBe(true);
    expect(policy.isRequester({ requesterId: ACTOR }, TARGET)).toBe(false);
    expect(policy.isExpired({ expiresAt: 2_000 }, 1_000)).toBe(false);
    expect(policy.isExpired({ expiresAt: 2_000 }, 2_000)).toBe(true);
  });

  it('tout identifiant est un snowflake', () => {
    expect(policy.hasValidIds({ channelId: '1550000000000000001', label: 'salon' })).toBe(true);
    expect(policy.hasValidIds({ channelId: 'general' })).toBe(false);
    expect(policy.hasValidIds({ roleId: '<@&123>' })).toBe(false);
    expect(policy.hasValidIds({ roleId: 123, userId: undefined })).toBe(true);
  });

  it('sans membre, sans outil, compte suspendu : refusé avant toute autre vérification', () => {
    const w = world();
    expect(policy.review(null, { tool: 't', input: {} }, tool(['ManageRoles']))).toMatchObject({ ok: false });
    expect(policy.review(w.addMember(ACTOR), { tool: 't', input: {} }, undefined)).toMatchObject({ ok: false, reason: expect.stringContaining('inconnu') });
    expect(policy.review(w.addMember(ACTOR, ['ManageRoles'], 5, true), { tool: 't', input: {} }, tool(['ManageRoles']))).toMatchObject({ ok: false, reason: expect.stringContaining('suspendu') });
  });

  it('les permissions de l\u0027outil manquantes sont nommées dans le refus', () => {
    const w = world();
    const actor = w.addMember(ACTOR, ['ManageRoles'], 5);
    expect(policy.review(actor, { tool: 'kickMember', input: { memberId: TARGET } }, tool(['KickMembers']))).toEqual({
      ok: false,
      reason: 'permission requise : KickMembers',
    });
  });

  it('dans le salon visé, il faut aussi y détenir la permission ; un salon absent ou masqué refuse', () => {
    const w = world();
    const actor = w.addMember(ACTOR, ['ManageChannels'], 5);
    w.addChannel('30', [ACTOR], ['ManageChannels']);
    w.addChannel('31', [ACTOR]);
    const action = { tool: 'deleteChannel', input: { channelId: '30' } };
    expect(policy.review(actor, { ...action, input: { channelId: '30' } }, tool(['ManageChannels']))).toEqual({ ok: true });
    expect(policy.review(actor, { ...action, input: { channelId: '31' } }, tool(['ManageChannels']))).toMatchObject({ ok: false, reason: expect.stringContaining('dans ce salon') });
    expect(policy.review(actor, { ...action, input: { channelId: '99' } }, tool(['ManageChannels']))).toMatchObject({ ok: false, reason: 'salon introuvable' });
  });

  it('hiérarchie : cible au-dessus refusée, rôle géré refusé, se donner un rôle sous soi accepté', () => {
    const w = world();
    const actor = w.addMember(ACTOR, ['ManageRoles', 'ModerateMembers'], 5);
    w.addMember(TARGET, [], 9);
    w.addRole('100', 4);
    w.addRole('101', 4, true);
    expect(policy.review(actor, { tool: 'addRoleToMember', input: { memberId: TARGET, roleId: '100' } }, tool(['ManageRoles']))).toMatchObject({ ok: false });
    expect(policy.review(actor, { tool: 'addRoleToMember', input: { memberId: ACTOR, roleId: '101' } }, tool(['ManageRoles']))).toMatchObject({ ok: false, reason: expect.stringContaining('intégration') });
    expect(policy.review(actor, { tool: 'addRoleToMember', input: { memberId: ACTOR, roleId: '100' } }, tool(['ManageRoles']))).toEqual({ ok: true });
  });

  it('une sanction ne vise jamais son auteur ; un bannissement peut viser un membre parti, pas un kick', () => {
    const w = world();
    const actor = w.addMember(ACTOR, ['BanMembers', 'KickMembers', 'ModerateMembers'], 5);
    expect(policy.review(actor, { tool: 'timeoutMember', input: { memberId: ACTOR } }, tool(['ModerateMembers']))).toMatchObject({ ok: false });
    expect(policy.review(actor, { tool: 'banMember', input: { userId: '1550000000000000099' } }, tool(['BanMembers']))).toEqual({ ok: true });
    expect(policy.review(actor, { tool: 'kickMember', input: { userId: '1550000000000000099' } }, tool(['KickMembers']))).toMatchObject({ ok: false });
  });

  it('le propriétaire du serveur passe la hiérarchie, pas les permissions qu\u0027il ne détient pas nominativement', () => {
    const w = world();
    const owner = w.addMember(OWNER, [], 0);
    w.addMember(TARGET, [], 99);
    expect(policy.review(owner, { tool: 'addRoleToMember', input: { memberId: TARGET } }, tool([]))).toEqual({ ok: true });
    expect(policy.review(owner, { tool: 'kickMember', input: { memberId: TARGET } }, tool(['KickMembers']))).toMatchObject({ ok: false, reason: 'permission requise : KickMembers' });
  });
});
