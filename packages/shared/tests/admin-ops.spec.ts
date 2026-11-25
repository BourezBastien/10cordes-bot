import { describe, expect, it } from 'vitest';
import { AdminOpSchema, opLabel, type AdminOp } from '../src/index.js';

/**
 * Les opérations d'administration que le modèle propose : chacune se lit avec
 * ses défauts, refuse ce que Discord refuserait, et porte un libellé lisible
 * (c'est lui que le demandeur voit dans le plan à confirmer).
 */

const CHANNEL_ID = '1550000000000000001';
const ROLE_ID = '1550000000000000002';
const USER_ID = '1550000000000000003';
const DAY_MS = 24 * 60 * 60 * 1_000;

describe('AdminOpSchema', () => {
  it.each([
    ['channel.create', { type: 'channel.create', name: 'annonces' }, { kind: 'text' }],
    ['channel.rename', { type: 'channel.rename', channelId: CHANNEL_ID, name: 'général' }, {}],
    ['channel.archive', { type: 'channel.archive', channelId: CHANNEL_ID }, {}],
    ['channel.delete', { type: 'channel.delete', channelId: CHANNEL_ID }, {}],
    ['role.create', { type: 'role.create', name: 'Membre' }, {}],
    ['role.rename', { type: 'role.rename', roleId: ROLE_ID, name: 'Ancien' }, {}],
    ['role.delete', { type: 'role.delete', roleId: ROLE_ID }, {}],
    ['member.timeout', { type: 'member.timeout', userId: USER_ID, durationMs: 60_000 }, {}],
    ['member.kick', { type: 'member.kick', userId: USER_ID }, {}],
    ['member.ban', { type: 'member.ban', userId: USER_ID }, {}],
  ])('%s se lit, avec ses défauts', (type, value, expected) => {
    const parsed = AdminOpSchema.parse(value);
    expect(parsed.type).toBe(type);
    expect(parsed).toMatchObject(expected);
  });

  it('les bornes de Discord sont admises : salon vocal avec sujet, rôle coloré, 28 jours', () => {
    expect(AdminOpSchema.safeParse({ type: 'channel.create', name: 'Vocal', kind: 'voice', topic: 'Réunion' }).success).toBe(true);
    expect(AdminOpSchema.safeParse({ type: 'role.create', name: 'Orange', color: 0xffffff }).success).toBe(true);
    expect(AdminOpSchema.safeParse({ type: 'member.timeout', userId: USER_ID, durationMs: 28 * DAY_MS, reason: 'Spam' }).success).toBe(true);
  });

  it.each([
    ['un type inconnu', { type: 'channel.pin' }],
    ['un nom vide', { type: 'channel.create', name: '' }],
    ['un nom trop long', { type: 'role.create', name: 'a'.repeat(101) }],
    ['un genre de salon inconnu', { type: 'channel.create', name: 'x', kind: 'forum' }],
    ['un identifiant vide', { type: 'channel.delete', channelId: '' }],
    ['une couleur hors bornes', { type: 'role.create', name: 'x', color: 0x1000000 }],
    ['une couleur négative', { type: 'role.create', name: 'x', color: -1 }],
    ['une exclusion de moins d\u0027une seconde', { type: 'member.timeout', userId: USER_ID, durationMs: 999 }],
    ['une exclusion de plus de 28 jours', { type: 'member.timeout', userId: USER_ID, durationMs: 28 * DAY_MS + 1 }],
    ['une durée non entière', { type: 'member.timeout', userId: USER_ID, durationMs: 1_500.5 }],
    ['une raison trop longue', { type: 'member.ban', userId: USER_ID, reason: 'a'.repeat(513) }],
    ['un sujet trop long', { type: 'channel.create', name: 'x', topic: 'a'.repeat(1025) }],
  ])('%s est refusé', (_label, value) => {
    expect(AdminOpSchema.safeParse(value).success).toBe(false);
  });
});

describe('opLabel', () => {
  it.each([
    [{ type: 'channel.create', name: 'annonces' }, 'Créer le salon **annonces** (text)'],
    [{ type: 'channel.create', name: 'Vocal', kind: 'voice' }, 'Créer le salon **Vocal** (voice)'],
    [{ type: 'channel.rename', channelId: CHANNEL_ID, name: 'général' }, `Renommer <#${CHANNEL_ID}> en **général**`],
    [{ type: 'channel.archive', channelId: CHANNEL_ID }, `Archiver <#${CHANNEL_ID}>`],
    [{ type: 'channel.delete', channelId: CHANNEL_ID }, `Supprimer <#${CHANNEL_ID}> (archivé avant suppression)`],
    [{ type: 'role.create', name: 'Membre' }, 'Créer le rôle **Membre**'],
    [{ type: 'role.create', name: 'Orange', color: 0xd95926 }, 'Créer le rôle **Orange** (#d95926)'],
    [{ type: 'role.rename', roleId: ROLE_ID, name: 'Ancien' }, `Renommer le rôle <@&${ROLE_ID}> en **Ancien**`],
    [{ type: 'role.delete', roleId: ROLE_ID }, `Supprimer le rôle <@&${ROLE_ID}>`],
    [{ type: 'member.timeout', userId: USER_ID, durationMs: 90_000 }, `Exclure temporairement <@${USER_ID}> 2 min`],
    [{ type: 'member.kick', userId: USER_ID }, `Expulser <@${USER_ID}>`],
    [{ type: 'member.ban', userId: USER_ID }, `Bannir <@${USER_ID}>`],
  ])('%o porte son libellé', (value, label) => {
    expect(opLabel(AdminOpSchema.parse(value) as AdminOp)).toBe(label);
  });
});
