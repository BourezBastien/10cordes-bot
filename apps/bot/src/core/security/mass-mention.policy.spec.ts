import { describe, expect, it } from 'vitest';
import type { Guild, GuildMember } from 'discord.js';
import { accessContextFromNames, guildAccessContext, type GuildAccessContext } from './access-policy';
import { massMentionPolicy, MassMentionPolicy } from './mass-mention.policy';
import { permissionsOf } from './permission-name';

/**
 * Mentions de masse : le bot a souvent le droit de pinguer @everyone là où
 * le demandeur ne l'a pas. Décision produit (18/11) : seuls le propriétaire
 * du serveur et un administrateur le peuvent ; le système, qui ne sait plus
 * qui a demandé, ne pingue jamais.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const MEMBER = '1550000000000000003';

function guild(): Guild {
  return { id: GUILD, ownerId: OWNER } as unknown as Guild;
}

function member(permissions: string[], userId = MEMBER): GuildMember {
  return { id: userId, guild: guild(), permissions: { toArray: () => permissions, has: () => false } } as unknown as GuildMember;
}

const names = (permissions: string[]): GuildAccessContext => accessContextFromNames(guild(), MEMBER, permissions);

describe('MassMentionPolicy · qui peut pinguer tout le serveur', () => {
  it('le propriétaire du serveur, même sans permission relevée', () => {
    const owner = member([], OWNER);
    expect(permissionsOf(owner)).toEqual([]);
    expect(massMentionPolicy.allows(guildAccessContext(guild(), OWNER, owner))).toBe(true);
  });

  it('un administrateur, par un membre comme par une liste de noms', () => {
    expect(massMentionPolicy.allows(guildAccessContext(guild(), MEMBER, member(['Administrator'])))).toBe(true);
    expect(massMentionPolicy.allows(names(['Administrator']))).toBe(true);
  });

  it.each([[['ManageGuild']], [['MentionEveryone']], [['ManageMessages', 'SendMessages']], [[]]])('pas %s seul', (permissions) => {
    expect(massMentionPolicy.allows(names(permissions))).toBe(false);
    expect(massMentionPolicy.allows(guildAccessContext(guild(), MEMBER, member(permissions)))).toBe(false);
  });

  it('jamais sans acteur (le système), ni membre introuvable', () => {
    expect(massMentionPolicy.allows(null)).toBe(false);
    expect(massMentionPolicy.allows(guildAccessContext(guild(), MEMBER, null))).toBe(false);
  });
});

describe('MassMentionPolicy · le texte tel que le bot peut l\u0027envoyer', () => {
  const text = 'Réunion @Everyone à 20 h, @here !';

  it('sans le droit, toute mention de masse est neutralisée, insensiblement à la casse', () => {
    expect(massMentionPolicy.guard(text, names(['ManageGuild']))).toBe('Réunion `Everyone` à 20 h, `here` !');
    expect(massMentionPolicy.guard(text, null)).toBe('Réunion `Everyone` à 20 h, `here` !');
  });

  it('avec le droit, le texte part tel quel', () => {
    expect(massMentionPolicy.guard(text, names(['Administrator']))).toBe(text);
  });

  it('la policy est sans état : deux instances se comportent pareil', () => {
    expect(new MassMentionPolicy().guard('@here', null)).toBe(massMentionPolicy.guard('@here', null));
  });
});
