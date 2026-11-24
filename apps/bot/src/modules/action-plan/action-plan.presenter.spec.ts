import { describe, expect, it } from 'vitest';
import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { v2TextLength } from '../../shared/ui/v2-text-length';
import { ActionPlanPresenter, describeAction } from './action-plan.presenter';
import { PLAN_LIMITS, type ActionPlan } from './action-plan.types';

/**
 * Panneau d'un plan d'action. POO pure : ces tests fixent le payload complet
 * tel que Discord le reçoit (sérialisé) : un conteneur Components V2, le
 * demandeur et l'expiration, une ligne par action, et des boutons qui ne
 * portent l'identifiant du plan que sur le panneau en attente. Le panneau
 * porte aussi le résumé du modèle et les actions écartées, et son texte
 * reste sous le plafond de Discord, au pire cas compris.
 */

const GUILD = '1550000000000000001';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';
const PLAN = 'cmplan0000000000001';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const EXPIRES = T0 + 15 * 60_000 + 999;
const FOOTER = 'Seul l\'auteur de la demande peut appliquer ou annuler. Chaque action est revérifiée au clic : permissions et hiérarchie.';
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const TITLE = '## Confirmer les actions (hors lecture)';

const FIRST = { tool: 'test.deleteThing', input: { target: 'salon-a' } };
const SECOND = { tool: 'test.renameThing', input: { target: 'salon-b', reason: 'nettoyage' } };
const THIRD = { tool: 'test.closeThing', input: {} };

const plan = (overrides: Partial<ActionPlan> = {}): ActionPlan => ({
  id: PLAN,
  guildId: GUILD,
  channelId: CHANNEL,
  requesterId: USER,
  messageId: 'msg-1',
  actions: [FIRST, SECOND, THIRD],
  summary: null,
  dropped: [],
  status: 'pending',
  createdAt: T0,
  expiresAt: EXPIRES,
  report: null,
  ...overrides,
});

interface Node {
  type: number;
  content?: string;
  custom_id?: string;
  label?: string;
  style?: number;
  components?: Node[];
}

/** Payload sérialisé : drapeaux, nombre de conteneurs, textes dans l'ordre, rangées de boutons. */
function shown(payload: { flags?: unknown; components?: readonly unknown[] }) {
  const json = JSON.parse(JSON.stringify(payload)) as { flags: number; components: Node[] };
  const children = json.components[0]?.components ?? [];
  return {
    flags: json.flags,
    containers: json.components.length,
    texts: children.filter((child) => child.type === ComponentType.TextDisplay).map((child) => child.content ?? ''),
    rows: children.filter((child) => child.type === ComponentType.ActionRow).map((row) => row.components ?? []),
  };
}

const outcome = (overrides: Partial<ActionPlan>): ReturnType<typeof shown> => shown(new ActionPlanPresenter().renderOutcome(plan(overrides)));

describe('describeAction · paramètres d\'une action sur une ligne', () => {
  it('clé=valeur, séparés par une virgule, dans l\'ordre des paramètres ; rien sans paramètres', () => {
    expect(describeAction(SECOND)).toBe('target=salon-b, reason=nettoyage');
    expect(describeAction(THIRD)).toBe('');
  });

  it('les valeurs vides (absentes, nulles, chaîne vide, faux) ne sont pas montrées ; zéro et vrai le sont', () => {
    expect(describeAction({ tool: 't', input: { absent: undefined, nul: null, vide: '', faux: false, zero: 0, vrai: true } })).toBe('zero=0, vrai=true');
  });

  it('les valeurs non textuelles sont sérialisées en JSON', () => {
    expect(describeAction({ tool: 't', input: { count: 3, ratio: 1.5, tags: ['a', 'b'], options: { nested: true } } })).toBe('count=3, ratio=1.5, tags=["a","b"], options={"nested":true}');
  });

  it('ni backtick ni saut de ligne : remplacés par des espaces', () => {
    const text = describeAction({ tool: 't', input: { target: 'salon\n`a`\r\nb' } });
    expect(text).toBe('target=salon  a   b');
    expect(text).not.toMatch(/[`\r\n]/u);
  });

  it('coupé à 160 caractères, points de suspension compris ; 160 caractères reste entier', () => {
    const value = (length: number): string => describeAction({ tool: 't', input: { target: 'x'.repeat(length) } });
    expect(value(153)).toBe(`target=${'x'.repeat(153)}`);
    expect(value(154)).toBe(`target=${'x'.repeat(150)}...`);
    expect(value(500)).toBe(`target=${'x'.repeat(150)}...`);
    expect(value(500).length).toBe(160);
  });
});

describe('ActionPlanPresenter · panneau à approuver', () => {
  it('un conteneur Components V2, jamais éphémère : titre au nom de la règle, demandeur et expiration, une ligne numérotée par action, pied', () => {
    const panel = shown(new ActionPlanPresenter().render(plan()));
    expect(panel.flags).toBe(MessageFlags.IsComponentsV2);
    expect(panel.containers).toBe(1);
    expect(panel.texts).toEqual([
      TITLE,
      `Demande de <@${USER}> · Expire <t:${(T0 + 15 * 60_000) / 1000}:R>`,
      '1. **test.deleteThing** · target=salon-a',
      '2. **test.renameThing** · target=salon-b, reason=nettoyage',
      '3. **test.closeThing**',
      `-# ${FOOTER}`,
    ]);
  });

  it('une seule rangée de deux boutons, appliquer puis annuler, portant chacun l\'identifiant du plan', () => {
    const rows = shown(new ActionPlanPresenter().render(plan())).rows;
    expect(rows.map((row) => row.map((button) => [button.custom_id, button.label, button.style]))).toEqual([
      [
        ['plan:apply~p=cmplan0000000000001', '✅ Appliquer', ButtonStyle.Success],
        ['plan:cancel~p=cmplan0000000000001', '❌ Annuler', ButtonStyle.Secondary],
      ],
    ]);
  });

  it('le résumé écrit par le modèle suit la ligne du demandeur', () => {
    const panel = shown(new ActionPlanPresenter().render(plan({ summary: 'Je vais renommer deux salons et fermer le troisième.' })));
    expect(panel.texts).toEqual([
      TITLE,
      `Demande de <@${USER}> · Expire <t:${(T0 + 15 * 60_000) / 1000}:R>`,
      'Je vais renommer deux salons et fermer le troisième.',
      '1. **test.deleteThing** · target=salon-a',
      '2. **test.renameThing** · target=salon-b, reason=nettoyage',
      '3. **test.closeThing**',
      `-# ${FOOTER}`,
    ]);
  });

  it('les actions écartées sont dites en sous-texte : trois détaillées, les autres comptées', () => {
    const prefix = 'permission manquante dans ce salon : ';
    const dropped = ['a', 'b', 'c', 'd', 'e'].map((tool) => ({ tool: `test.${tool}Thing`, reason: `${prefix}${'r'.repeat(160)}` }));
    const panel = shown(new ActionPlanPresenter().render(plan({ dropped })));
    // La raison d'une action écartée est coupée à 100 caractères.
    expect(panel.texts[5]).toBe(`-# Écartée (le demandeur ne peut pas l\'exécuter) : **test.aThing** · ${prefix}${'r'.repeat(100 - prefix.length)}`);
    expect(panel.texts.slice(5).map((line) => line.slice(0, 24))).toEqual([
      '-# Écartée (le demandeur',
      '-# Écartée (le demandeur',
      '-# Écartée (le demandeur',
      '-# … et 2 autre(s) actio',
      `-# ${FOOTER}`.slice(0, 24),
    ]);
  });
});

describe('ActionPlanPresenter · plafond de texte de Discord', () => {
  /** Texte total du panneau sérialisé, comme Discord le compte. */
  const total = (payload: { components?: readonly unknown[] }): number => v2TextLength(payload);

  it('au pire cas (dix actions aux paramètres longs, résumé maximal, actions écartées), le panneau reste sous 4 000 caractères', () => {
    const actions = Array.from({ length: PLAN_LIMITS.maxActions }, (_, index) => ({
      tool: `test.${'t'.repeat(36)}`,
      input: { target: `${index}-${'x'.repeat(200)}`, content: 'y'.repeat(400) },
    }));
    const dropped = Array.from({ length: PLAN_LIMITS.maxActions }, (_, index) => ({ tool: `test.ecarte${index}`, reason: 'z'.repeat(300) }));
    const payload = new ActionPlanPresenter().render(plan({ actions, dropped, summary: 's'.repeat(PLAN_LIMITS.summaryMax) }));
    const length = total(payload);
    expect(length).toBeLessThan(4_000);
    expect(length).toBeLessThanOrEqual(PLAN_LIMITS.textMax);
    // Les dix actions à approuver sont toujours là, dans l'ordre.
    const texts = shown(payload).texts;
    expect(texts.filter((line) => /^\d+\. \*\*test\.t+/u.test(line))).toHaveLength(PLAN_LIMITS.maxActions);
  });

  it('un panneau qui dépasse serre d\'abord le résumé, puis le retire, avant de toucher aux actions', () => {
    const long = plan({
      actions: Array.from({ length: PLAN_LIMITS.maxActions }, (_, index) => ({ tool: `test.outil${index}`, input: { target: 'x'.repeat(300) } })),
      summary: 's'.repeat(PLAN_LIMITS.summaryMax),
    });
    const full = new ActionPlanPresenter().render(long);
    expect(total(full)).toBeLessThanOrEqual(PLAN_LIMITS.textMax);
    expect(shown(full).texts.some((line) => /^s{300,}$/u.test(line))).toBe(true);
  });

  it('rien à confirmer : les actions écartées et pourquoi, sans bouton', () => {
    const payload = new ActionPlanPresenter().rejected([{ tool: 'test.aThing', reason: 'cible placée au-dessus de toi' }]);
    const panel = shown(payload);
    expect(panel.rows).toEqual([]);
    expect(panel.texts).toEqual([
      '## Rien à confirmer',
      '-# Écartée (le demandeur ne peut pas l\'exécuter) : **test.aThing** · cible placée au-dessus de toi',
      '-# Aucune action n\'a été proposée ni exécutée. Une de ces actions te semble due : passe par le staff.',
    ]);
    expect(total(payload)).toBeLessThan(4_000);
  });
});

describe('ActionPlanPresenter · résultat du plan', () => {
  it('exécuté : chaque action validée, plus aucun bouton', () => {
    const panel = outcome({ status: 'executed', report: { done: 3 } });
    expect(panel.flags).toBe(MessageFlags.IsComponentsV2);
    expect(panel.containers).toBe(1);
    expect(panel.rows).toEqual([]);
    expect(panel.texts).toEqual([
      '## Plan exécuté',
      `Demande de <@${USER}>`,
      '✅ 1. **test.deleteThing**',
      '✅ 2. **test.renameThing**',
      '✅ 3. **test.closeThing**',
      '-# 3 action(s) exécutée(s).',
    ]);
  });

  it('interrompu : validées, puis la ligne de celle qui a tout arrêté avec sa raison, le compte au pied', () => {
    const panel = outcome({ status: 'interrupted', report: { done: 1, stoppedAt: SECOND.tool, reason: 'permission requise : KickMembers' } });
    expect(panel.rows).toEqual([]);
    expect(panel.texts).toEqual([
      '## Plan interrompu',
      `Demande de <@${USER}>`,
      '✅ 1. **test.deleteThing**',
      '❌ 2. **test.renameThing** : permission requise : KickMembers',
      '3. **test.closeThing**',
      '-# 1/3 action(s) exécutée(s). Arrêt sur test.renameThing : permission requise : KickMembers',
    ]);
  });

  it('une raison longue est coupée à 200 caractères, dans la ligne et au pied', () => {
    const reason = 'r'.repeat(240);
    const panel = outcome({ status: 'interrupted', report: { done: 0, stoppedAt: FIRST.tool, reason } });
    expect(panel.texts.slice(2)).toEqual([
      `❌ 1. **test.deleteThing** : ${'r'.repeat(200)}`,
      '2. **test.renameThing**',
      '3. **test.closeThing**',
      `-# 0/3 action(s) exécutée(s). Arrêt sur test.deleteThing : ${'r'.repeat(200)}`,
    ]);
  });

  it.each([
    ['cancelled', '## Plan annulé', 'Rien n\'a été exécuté.'],
    ['expired', '## Plan expiré', 'Le délai d\'approbation est dépassé, rien n\'a été exécuté.'],
  ] as const)('%s : aucune action exécutée, dit sur chaque ligne', (status, title, footer) => {
    const panel = outcome({ status, report: { done: 0 } });
    expect(panel.flags).toBe(MessageFlags.IsComponentsV2);
    expect(panel.rows).toEqual([]);
    expect(panel.texts).toEqual([
      title,
      `Demande de <@${USER}>`,
      '1. **test.deleteThing** (non exécutée)',
      '2. **test.renameThing** (non exécutée)',
      '3. **test.closeThing** (non exécutée)',
      `-# ${footer}`,
    ]);
  });

  it('en attente ou en cours : titre « Plan en cours », compte au pied', () => {
    expect(outcome({ status: 'executing', report: { done: 1 } }).texts).toEqual([
      '## Plan en cours',
      `Demande de <@${USER}>`,
      '✅ 1. **test.deleteThing**',
      '2. **test.renameThing**',
      '3. **test.closeThing**',
      '-# 1/3 action(s) exécutée(s).',
    ]);
    expect(outcome({ report: null }).texts.at(-1)).toBe('-# 0/3 action(s) exécutée(s).');
  });
});

describe('ActionPlanPresenter · messages éphémères', () => {
  const presenter = new ActionPlanPresenter();
  const text = (payload: { components: Array<{ toJSON: () => { content?: string } }> }): string =>
    payload.components.map((component) => component.toJSON().content ?? '').join('\n');

  it('denied : le refus sous le panneau interdit, éphémère et Components V2', () => {
    const payload = presenter.denied('Seul l\'auteur de la demande peut appliquer ce plan.');
    expect(payload.flags).toBe(EPHEMERAL_V2);
    expect(payload.components).toHaveLength(1);
    expect(text(payload)).toBe('🚫 Seul l\'auteur de la demande peut appliquer ce plan.');
  });

  it.each([
    ['exécuté', { status: 'executed', report: { done: 3 } }, '✅ **Plan exécuté**\n3 action(s) exécutée(s).'],
    ['annulé', { status: 'cancelled', report: { done: 0 } }, 'ℹ️ **Plan annulé**\nRien n\'a été exécuté.'],
    ['interrompu', { status: 'interrupted', report: { done: 1, stoppedAt: SECOND.tool, reason: 'refusé' } }, '⚠️ **Plan interrompu**\n1/3 action(s) exécutée(s). Arrêt sur test.renameThing : refusé'],
    ['expiré', { status: 'expired', report: { done: 0 } }, '⚠️ **Plan expiré**\nLe délai d\'approbation est dépassé, rien n\'a été exécuté.'],
  ] as const)('receipt : accusé d\'un plan %s, éphémère et Components V2', (_label, overrides, expected) => {
    const payload = presenter.receipt(plan(overrides));
    expect(payload.flags).toBe(EPHEMERAL_V2);
    expect(payload.components).toHaveLength(1);
    expect(text(payload)).toBe(expected);
  });
});
