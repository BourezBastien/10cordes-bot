import { describe, expect, it } from 'vitest';
import {
  AccessPolicySchema,
  ConditionSpecSchema,
  InteractionBindingSchema,
  ModalInputSchema,
  ModalSpecSchema,
  PipelineStepSchema,
  SurfaceDefinitionSchema,
  SurfaceRowSchema,
  validatePipelineReferences,
  validateSurfaceDefinition,
  type ConditionSpec,
  type PipelineStep,
  type SurfaceDefinition,
} from '../src/index.js';

/**
 * Le contrat du moteur de surfaces, tel que le bot le valide avant
 * d'enregistrer une définition : un bouton, une étape, une condition, un
 * modal, une politique d'accès, une définition entière, et les règles que le
 * schéma seul ne sait pas dire (clés uniques, openModal en tête, budget de
 * texte, références d'étape).
 */

const runTool = (name: string, input: Record<string, unknown> = {}): PipelineStep => ({ type: 'runTool', name, input });
const say = (content: string): PipelineStep => ({ type: 'sendMessage', content });
const owner: ConditionSpec = { kind: 'state', path: 'owner', op: 'exists' };
const binding = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ key: 'close', label: 'Fermer', pipeline: [say('Fermé.')], ...overrides });
const problems = (parsed: { success: boolean; error?: { issues: Array<{ message: string }> } }): string[] =>
  parsed.success ? [] : (parsed.error?.issues ?? []).map((issue) => issue.message);
const step = (value: unknown) => PipelineStepSchema.safeParse(value);
const definition = (overrides: Record<string, unknown> = {}): SurfaceDefinition => SurfaceDefinitionSchema.parse({ rows: [{ kind: 'buttons', buttons: [binding()] }], ...overrides });

describe('InteractionBindingSchema', () => {
  it('les défauts : style primaire, actif, accès libre', () => {
    expect(InteractionBindingSchema.parse(binding())).toMatchObject({ style: 'primary', disabled: false, access: {} });
  });

  it('la clé est kebab-case, 30 caractères au plus', () => {
    expect(InteractionBindingSchema.safeParse(binding({ key: 'close-ticket-2' })).success).toBe(true);
    expect(problems(InteractionBindingSchema.safeParse(binding({ key: 'Close' })))).toEqual([expect.stringContaining('kebab-case')]);
    for (const key of ['-close', 'close_1', 'Close', 'a'.repeat(31)]) expect(InteractionBindingSchema.safeParse(binding({ key })).success, key).toBe(false);
    // Le tiret final passe : la clé voyage dans le customId (`surface:act~b=key`), où il ne gêne rien.
    expect(InteractionBindingSchema.safeParse(binding({ key: 'close-' })).success).toBe(true);
  });

  it('le pipeline compte de 1 à 20 étapes', () => {
    expect(InteractionBindingSchema.safeParse(binding({ pipeline: [] })).success).toBe(false);
    expect(InteractionBindingSchema.safeParse(binding({ pipeline: Array.from({ length: 20 }, (_, index) => say(`s${index}`)) })).success).toBe(true);
    expect(InteractionBindingSchema.safeParse(binding({ pipeline: Array.from({ length: 21 }, (_, index) => say(`s${index}`)) })).success).toBe(false);
  });
});

describe('PipelineStepSchema', () => {
  it('un champ facultatif sans défaut reste absent, il ne devient pas undefined', () => {
    expect('channelId' in PipelineStepSchema.parse({ type: 'sendMessage', content: 'Bonjour' })).toBe(false);
    expect('value' in PipelineStepSchema.parse({ type: 'setState', path: 'count' })).toBe(false);
  });

  it.each([
    ['runTool', { type: 'runTool', name: 'records.list' }, { input: {} }],
    ['setState', { type: 'setState', path: 'ticket.owner' }, { mode: 'set' }],
    ['setState (valeur)', { type: 'setState', path: 'count', value: 3, mode: 'increment' }, { mode: 'increment', value: 3 }],
    ['updateComponent', { type: 'updateComponent', binding: 'close', patch: { label: 'Fermé', disabled: true } }, { patch: { label: 'Fermé', disabled: true } }],
    ['sendMessage', { type: 'sendMessage', content: 'Bonjour' }, {}],
    ['replyEphemeral', { type: 'replyEphemeral', content: 'Bien reçu' }, {}],
    ['openModal', { type: 'openModal', modal: { title: 'Raison', inputs: [{ id: 'reason', label: 'Raison' }] } }, { modal: { inputs: [{ style: 'short', required: true }] } }],
    ['record.write', { type: 'record.write', collection: 'tickets', data: { title: 'Panne' } }, {}],
    ['trigger.schedule', { type: 'trigger.schedule', delaySec: 60, steps: [say('Plus tard.')] }, { steps: [say('Plus tard.')] }],
    ['trigger.cancelByKey', { type: 'trigger.cancelByKey', key: 'voc-123' }, {}],
    ['random', { type: 'random', min: 1, max: 6 }, {}],
    ['llm', { type: 'llm', prompt: 'Résume' }, { maxChars: 400, parseJson: false }],
    ['if', { type: 'if', condition: owner, then: [say('À toi.')] }, { then: [say('À toi.')] }],
    ['forEach', { type: 'forEach', over: 'roleMembers', roleId: '1550000000000000001', steps: [runTool('members.kick')] }, { limit: 25, as: 'member' }],
    ['claimOnce', { type: 'claimOnce', key: 'claim-{{actor.id}}' }, { ttlSec: 60, winnerVar: 'claimed' }],
  ])('%s se lit, avec ses défauts', (_label, value, expected) => {
    const parsed = step(value);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject(expected);
  });

  it('les étapes s\u0027imbriquent : if dans forEach dans trigger.schedule', () => {
    const nested = step({
      type: 'trigger.schedule',
      cron: '0 9 * * 1',
      condition: { kind: 'all', conditions: [owner, { kind: 'not', condition: { kind: 'any', conditions: [{ kind: 'slidingWindow', key: 'spam', threshold: 3, windowSec: 60 }] } } ] },
      steps: [
        {
          type: 'forEach',
          over: 'records',
          collection: 'birthdays',
          steps: [{ type: 'if', condition: { kind: 'regex', input: '{{record.date}}', pattern: '\\d{2}-\\d{2}' }, then: [say('Joyeux anniversaire')], else: [say('Rien aujourd\u0027hui')] }],
        },
      ],
    });
    expect(nested.success).toBe(true);
  });

  it.each([
    ['un type inconnu', { type: 'teleport' }],
    ['un nom de tool trop court', { type: 'runTool', name: 'ab' }],
    ['un mode d\u0027état inconnu', { type: 'setState', path: 'x', mode: 'reset' }],
    ['un style de composant inconnu', { type: 'updateComponent', binding: 'b', patch: { style: 'purple' } }],
    ['un message vide', { type: 'sendMessage', content: '' }],
    ['un modal sans champ', { type: 'openModal', modal: { title: 'Vide', inputs: [] } }],
    ['un modal de 6 champs', { type: 'openModal', modal: { title: 'Trop', inputs: Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, label: 'F' })) } }],
    ['un délai nul', { type: 'trigger.schedule', delaySec: 0, steps: [say('x')] }],
    ['un trigger sans étape', { type: 'trigger.schedule', delaySec: 10, steps: [] }],
    ['un compte à rebours court', { type: 'llm', prompt: 'Résume', maxChars: 10 }],
    ['une boucle sans étape', { type: 'forEach', over: 'records', steps: [] }],
    ['une itération nulle', { type: 'forEach', over: 'roleMembers', limit: 0, steps: [say('x')] }],
  ])('%s est refusé', (_label, value) => {
    expect(step(value).success).toBe(false);
  });
});

describe('ModalInputSchema', () => {
  it('les défauts : court, obligatoire', () => {
    expect(ModalInputSchema.parse({ id: 'reason', label: 'Raison' })).toMatchObject({ style: 'short', required: true });
  });

  it.each([
    ['un identifiant trop long', { id: 'a'.repeat(46), label: 'Raison' }],
    ['un libellé trop long', { id: 'reason', label: 'a'.repeat(46) }],
    ['un style inconnu', { id: 'reason', label: 'Raison', style: 'title' }],
    ['une longueur minimale négative', { id: 'reason', label: 'Raison', minLength: -1 }],
    ['une longueur maximale nulle', { id: 'reason', label: 'Raison', maxLength: 0 }],
    ['une longueur maximale au-delà de Discord', { id: 'reason', label: 'Raison', maxLength: 4001 }],
  ])('%s est refusé', (_label, value) => {
    expect(ModalInputSchema.safeParse(value).success).toBe(false);
  });

  it('un modal accepte de 1 à 5 champs, 45 caractères de titre', () => {
    expect(ModalSpecSchema.safeParse({ title: 'a'.repeat(46), inputs: [{ id: 'a', label: 'A' }] }).success).toBe(false);
    expect(ModalSpecSchema.safeParse({ title: 'Ok', inputs: Array.from({ length: 5 }, (_, index) => ({ id: `f${index}`, label: 'F' })) }).success).toBe(true);
  });
});

describe('ConditionSpecSchema', () => {
  it.each([
    ['un état égal à une référence', { kind: 'state', path: 'owner', op: 'eq', value: '{{actor.id}}' }],
    ['un état comparé à un nombre', { kind: 'state', path: 'count', op: 'gte', value: 3 }],
    ['un comptage de records filtré', { kind: 'records.count', collection: 'tickets', createdBy: '{{actor.id}}', filterDataContains: 'urgent', op: 'gte', value: 1 }],
    ['un membre dans un salon vocal', { kind: 'voice.inChannel', userId: '{{actor.id}}', channelId: '{{state.vocal}}' }],
    ['un membre qui a un rôle', { kind: 'member.hasRole', userId: '{{actor.id}}', roleId: '1550000000000000001' }],
    ['un compte de 7 jours', { kind: 'member.accountAgeDays', userId: '{{actor.id}}', op: 'gte', value: 7 }],
    ['une arrivée de moins de 30 jours', { kind: 'member.joinedDays', userId: '{{actor.id}}', op: 'lte', value: 30 }],
    ['une expression régulière', { kind: 'regex', input: '{{state.title}}', pattern: '^\\w+$' }],
    ['une fenêtre glissante', { kind: 'slidingWindow', key: 'spam-{{actor.id}}', threshold: 3, windowSec: 60 }],
    ['des combinateurs imbriqués', { kind: 'all', conditions: [{ kind: 'not', condition: { kind: 'any', conditions: [{ kind: 'state', path: 'open', op: 'exists' }] } }] }],
  ])('%s se lit', (_label, condition) => {
    expect(ConditionSpecSchema.safeParse(condition).success).toBe(true);
  });

  it.each([
    ['un genre inconnu', { kind: 'weather', op: 'sunny' }],
    ['un opérateur d\u0027état inconnu', { kind: 'state', path: 'x', op: 'matches' }],
    ['un rôle trop court', { kind: 'member.hasRole', userId: '1550000000000000001', roleId: '12' }],
    ['un seuil nul', { kind: 'slidingWindow', key: 'k', threshold: 0, windowSec: 10 }],
    ['un combinateur vide', { kind: 'all', conditions: [] }],
    ['un comptage négatif', { kind: 'records.count', collection: 'c', op: 'eq', value: -1 }],
  ])('%s est refusé', (_label, condition) => {
    expect(ConditionSpecSchema.safeParse(condition).success).toBe(false);
  });
});

describe('AccessPolicySchema', () => {
  it('tout est facultatif', () => {
    expect(AccessPolicySchema.parse({})).toEqual({});
  });

  it('une politique complète se lit', () => {
    expect(
      AccessPolicySchema.parse({
        permissions: ['ManageGuild'],
        roleIds: ['1550000000000000001'],
        userIds: ['1550000000000000002'],
        cooldownPerUserSec: 30,
        condition: { kind: 'state', path: 'open', op: 'exists' },
        denyMessage: 'Fermé.',
      }),
    ).toMatchObject({ cooldownPerUserSec: 30, denyMessage: 'Fermé.' });
  });

  it.each([
    ['une permission trop courte', { permissions: ['ab'] }],
    ['plus de 10 permissions', { permissions: Array.from({ length: 11 }, () => 'ManageGuild') }],
    ['un rôle trop court', { roleIds: ['123'] }],
    ['un refroidissement nul', { cooldownPerUserSec: 0 }],
    ['un refus trop long', { denyMessage: 'x'.repeat(301) }],
  ])('%s est refusé', (_label, policy) => {
    expect(AccessPolicySchema.safeParse(policy).success).toBe(false);
  });
});

describe('SurfaceRowSchema et SurfaceDefinitionSchema', () => {
  it('une rangée de boutons compte de 1 à 5, un select de 1 à 25 options', () => {
    expect(SurfaceRowSchema.safeParse({ kind: 'buttons', buttons: [] }).success).toBe(false);
    expect(SurfaceRowSchema.safeParse({ kind: 'buttons', buttons: Array.from({ length: 5 }, (_, index) => binding({ key: `b${index}` })) }).success).toBe(true);
    expect(SurfaceRowSchema.safeParse({ kind: 'select', select: { options: Array.from({ length: 26 }, (_, index) => binding({ key: `o${index}` })) } }).success).toBe(false);
    expect(SurfaceRowSchema.safeParse({ kind: 'select', select: { options: [binding()] } }).data).toMatchObject({ select: { placeholder: 'Choisis une option' } });
    expect(SurfaceRowSchema.safeParse({ kind: 'menu' }).success).toBe(false);
  });

  it('une définition : état initial vide par défaut, textes et images nés en option', () => {
    expect(definition()).toMatchObject({ initialState: {} });
    expect(
      definition({ title: 'Tickets', description: 'Ouvre un ticket', accentColor: 0xd95926, footer: '10cordes', thumbnailUrl: 'https://cdn.discordapp.com/icons/1/a.png', imageUrl: 'https://example.test/a.png', initialState: { open: 0 } }),
    ).toMatchObject({ title: 'Tickets', accentColor: 0xd95926, initialState: { open: 0 } });
  });

  it.each([
    ['un titre vide', { title: '' }],
    ['un titre trop long', { title: 'a'.repeat(121) }],
    ['une description trop longue', { description: 'a'.repeat(3401) }],
    ['une couleur hors bornes', { accentColor: 0x1000000 }],
    ['une couleur négative', { accentColor: -1 }],
    ['une image qui n\u0027est pas une adresse', { imageUrl: 'pas-une-adresse' }],
    ['plus de 10 rangées', { rows: Array.from({ length: 11 }, () => ({ kind: 'buttons', buttons: [binding()] })) }],
    ['sans rangée', { rows: undefined }],
  ])('%s est refusé', (_label, overrides) => {
    expect(SurfaceDefinitionSchema.safeParse({ rows: [{ kind: 'buttons', buttons: [binding()] }], ...overrides }).success).toBe(false);
  });
});

describe('validatePipelineReferences et validateSurfaceDefinition', () => {
  const BAD = '{{steps.0.data.id}}';

  it('une définition saine ne rend aucune erreur, boutons comme options', () => {
    const sound = definition({
      rows: [
        { kind: 'buttons', buttons: [binding({ pipeline: [{ type: 'openModal', modal: { title: 'Raison', inputs: [{ id: 'reason', label: 'Raison' }] } }] })] },
        { kind: 'select', select: { options: [binding({ key: 'opt-1', pipeline: [runTool('records.list', { channelId: '{{state.x}}' }), runTool('records.get', { id: '{{steps.0.value}}' })] })] } },
      ],
    });
    expect(validatePipelineReferences(sound)).toEqual([]);
    expect(validateSurfaceDefinition(sound)).toEqual([]);
  });

  it('une référence d\u0027étape fausse est nommée par le bouton ou l\u0027option qui la porte', () => {
    const broken = definition({
      rows: [
        { kind: 'buttons', buttons: [binding({ key: 'open', pipeline: [runTool('records.write', { id: BAD })] })] },
        { kind: 'select', select: { options: [binding({ key: 'pick', pipeline: [runTool('records.write', { id: BAD })] })] } },
      ],
    });
    expect(validatePipelineReferences(broken)).toEqual([expect.stringContaining('bouton « open »'), expect.stringContaining('option « pick »')]);
  });

  it('clé dupliquée, openModal hors première position', () => {
    const duplicated = definition({ rows: [{ kind: 'buttons', buttons: [binding(), binding({ label: 'Deux fois' })] }] });
    expect(validateSurfaceDefinition(duplicated)).toEqual(['Clé de binding dupliquée : close.']);
    const late = definition({ rows: [{ kind: 'buttons', buttons: [binding({ pipeline: [say('D\u0027abord'), { type: 'openModal', modal: { title: 'Raison', inputs: [{ id: 'reason', label: 'Raison' }] } }] })] }] });
    expect(validateSurfaceDefinition(late)).toEqual([expect.stringContaining('openModal doit être la PREMIÈRE étape de close')]);
  });

  it('les textes sont comptés en octets : 3 400 émojis dépassent le budget Components V2', () => {
    const heavy = definition({ description: '🎁'.repeat(3400) });
    expect(validateSurfaceDefinition(heavy)).toEqual(['Textes trop lourds (13600 octets > 10 000 : limite Components V2).']);
    expect(validateSurfaceDefinition(definition({ title: 'é'.repeat(120), footer: 'f'.repeat(200) }))).toEqual([]);
    // Comptés en octets UTF-8, pas en caractères : 3 334 caractères sur trois octets dépassent le budget.
    expect(validateSurfaceDefinition(definition({ description: '中'.repeat(3334) }))).toEqual(['Textes trop lourds (10002 octets > 10 000 : limite Components V2).']);
    expect(validateSurfaceDefinition(definition({ description: '中'.repeat(3333) }))).toEqual([]);
  });

  it('au-delà de 4 références fausses, les autres sont comptées', () => {
    const many = definition({
      rows: [{ kind: 'buttons', buttons: ['a', 'b', 'c', 'd', 'e'].map((key) => binding({ key, pipeline: [runTool('records.write', { id: BAD })] })) }],
    });
    const errors = validatePipelineReferences(many);
    expect(errors).toHaveLength(5);
    expect(errors.slice(0, 4).map((error) => error.match(/bouton « [abcde] »/u)?.[0])).toEqual(['bouton « a »', 'bouton « b »', 'bouton « c »', 'bouton « d »']);
    expect(errors.slice(0, 4).every((error) => error.includes('le résultat d\u0027un outil se lit sans `data`'))).toBe(true);
    expect(errors[4]).toBe('… et 1 autre(s) référence(s) fausse(s).');
  });
});
