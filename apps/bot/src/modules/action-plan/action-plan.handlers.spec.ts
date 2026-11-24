import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, MessageFlags } from 'discord.js';
import { setFileLog } from '../logging/file-log.service';
import { ActionPlanApplyButton, ActionPlanApplyHandler, ActionPlanCancelButton, ActionPlanCancelHandler } from './action-plan.handlers';
import { ActionPlanModule } from './action-plan.module';
import { ActionPlanService } from './action-plan.service';
import { PLAN_IDS, planButtonId, planIdOf } from './action-plan.types';

/**
 * Boutons « Appliquer » et « Annuler » d'un plan. Un vrai clic exige une
 * interaction Discord (non simulable par un rig) : ces tests fixent ce qui
 * relève du code, à savoir les métadonnées du dispatcher (sans décorateur,
 * un bouton reste muet), la relève de l'identifiant du plan dans le
 * customId, et la promesse qu'aucun clic n'est silencieux : tout échec est
 * journalisé et répondu en éphémère avec la référence du clic.
 */

const PLAN = 'abc123';
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const BUTTONS = [
  ['apply', ActionPlanApplyHandler, ActionPlanApplyButton, 'plan:apply', '✅ Appliquer', 'success'],
  ['cancel', ActionPlanCancelHandler, ActionPlanCancelButton, 'plan:cancel', '❌ Annuler', 'secondary'],
] as const;
type Action = 'apply' | 'cancel';
type Plans = Record<Action, ReturnType<typeof vi.fn>>;
interface FakeInteraction {
  id: string;
  customId: string;
  replied: boolean;
  deferred: boolean;
  reply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
}

/** Journal JSONL du bot : les lignes qu'il reçoit. */
const events = vi.fn();

/** Doublure du service : les deux entrées du clic, ne faisant rien. */
const fakePlans = (): Plans => ({ apply: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) });
const fakeInteraction = (overrides: Partial<FakeInteraction> = {}): FakeInteraction => ({
  id: 'interaction-9',
  customId: `plan:apply~p=${PLAN}`,
  replied: false,
  deferred: false,
  reply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});
const handlerOf = (action: Action, plans: Plans): ActionPlanApplyHandler | ActionPlanCancelHandler =>
  action === 'apply' ? new ActionPlanApplyHandler(plans as never) : new ActionPlanCancelHandler(plans as never);
const otherOf = (action: Action): Action => (action === 'apply' ? 'cancel' : 'apply');
const textsOf = (components: unknown): string[] =>
  (components as Array<{ toJSON: () => { type: number; content?: string } }>)
    .map((component) => component.toJSON())
    .filter((node) => node.type === ComponentType.TextDisplay)
    .map((node) => node.content ?? '');
const SENT = [{ flags: EPHEMERAL_V2, components: [expect.any(Object)], allowedMentions: { parse: [] } }];

beforeEach(() => {
  events.mockClear();
  setFileLog({ event: events, llm: vi.fn() } as never);
});

describe('routage des boutons (métadonnées du dispatcher)', () => {
  it('chaque handler est lié à son bouton, décoré avec sa base, son libellé et son style', () => {
    for (const [, handler, component, customId, label, style] of BUTTONS) {
      expect(Reflect.getOwnMetadata('spraxium:button_handler', handler)).toEqual({ component });
      expect(Reflect.getOwnMetadata('spraxium:button_component', component)).toEqual({ isLink: false, customId, label, style });
    }
  });

  it('la base de chaque bouton est celle que le panneau écrit dans ses customIds ; l\'interaction arrive en premier paramètre', () => {
    expect([PLAN_IDS.apply, PLAN_IDS.cancel]).toEqual(['plan:apply', 'plan:cancel']);
    expect(planButtonId(PLAN_IDS.apply, PLAN)).toBe(`plan:apply~p=${PLAN}`);
    for (const [, handler, , customId] of BUTTONS) {
      expect(planButtonId(customId, PLAN).split('~')[0]).toBe(customId);
      expect(Reflect.getMetadata('spraxium:ctx_param', handler.prototype, 'handle')).toBe(0);
    }
  });

  it('le module déclare ses deux handlers et son service : sans la clé handlers, le framework n\'enregistre aucune interaction', () => {
    const metadata = Reflect.getOwnMetadata('spraxium:module', ActionPlanModule);
    expect(metadata.handlers).toEqual([ActionPlanApplyHandler, ActionPlanCancelHandler]);
    expect(metadata.providers).toEqual([ActionPlanService]);
    expect(metadata.exports).toEqual([ActionPlanService]);
    expect(Reflect.getOwnMetadata('spraxium:global', ActionPlanModule)).toBe(true);
  });
});

describe('identifiant du plan porté par un customId', () => {
  it('se relit après l\'un ou l\'autre séparateur, tel quel', () => {
    expect(planIdOf(`plan:apply~p=${PLAN}`)).toBe(PLAN);
    expect(planIdOf(`plan:cancel&p=${PLAN}`)).toBe(PLAN);
    expect(planIdOf('plan:apply~p=ABC123')).toBe('ABC123');
    expect(planButtonId(PLAN_IDS.cancel, PLAN)).toBe(`plan:cancel~p=${PLAN}`);
  });

  it.each(['plan:apply', 'plan:cancel', 'plan:apply~p=', 'plan:apply~p=~c=x', ''])('« %s » ne porte aucun identifiant', (customId) => {
    expect(planIdOf(customId)).toBeNull();
  });
});

describe('ActionPlanApplyHandler et ActionPlanCancelHandler', () => {
  it.each([['apply'], ['cancel']] as const)('%s : relit l\'identifiant du customId et appelle le service, une fois, avec l\'interaction reçue', async (action) => {
    const plans = fakePlans();
    const interaction = fakeInteraction({ customId: `plan:${action}~p=${PLAN}` });
    await handlerOf(action, plans).handle(interaction as never);
    expect(plans[action].mock.calls).toEqual([[PLAN, interaction]]);
    expect(plans[otherOf(action)]).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it.each(['plan:apply', 'plan:cancel', 'plan:apply~p=', ''])('customId « %s » sans identifiant : refus éphémère, le service n\'est pas appelé', async (customId) => {
    for (const action of ['apply', 'cancel'] as const) {
      const plans = fakePlans();
      const interaction = fakeInteraction({ customId });
      await handlerOf(action, plans).handle(interaction as never);
      expect(interaction.reply.mock.calls).toEqual([SENT]);
      expect(textsOf(interaction.reply.mock.calls[0][0].components)).toEqual(['❌ Bouton de plan sans identifiant : ce bouton vient d\'un ancien panneau.']);
      expect(plans.apply).not.toHaveBeenCalled();
      expect(plans.cancel).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
    }
  });

  it.each([['apply'], ['cancel']] as const)('%s : une exception du service est journalisée et répondue en éphémère avec la référence du clic', async (action) => {
    const plans = fakePlans();
    plans[action].mockRejectedValue(new Error('boom'));
    const interaction = fakeInteraction({ customId: `plan:${action}~p=${PLAN}` });

    await expect(handlerOf(action, plans).handle(interaction as never)).resolves.toBeUndefined();

    expect(plans[action].mock.calls).toEqual([[PLAN, interaction]]);
    expect(plans[otherOf(action)]).not.toHaveBeenCalled();
    expect(events.mock.calls).toEqual([['warn', 'action-plan', 'interaction_failed', { action, planId: PLAN, interactionId: 'interaction-9', error: 'boom' }]]);
    expect(interaction.reply.mock.calls).toEqual([SENT]);
    expect(textsOf(interaction.reply.mock.calls[0][0].components)).toEqual(['❌ Action impossible (boom) [interaction-9]']);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it.each([
    ['déférée', { deferred: true }],
    ['déjà répondue', { replied: true }],
  ] as const)('interaction %s : la réponse d\'échec passe par editReply', async (_label, state) => {
    const plans = fakePlans();
    plans.apply.mockRejectedValue(new Error('boom'));
    const interaction = fakeInteraction({ ...state });
    await handlerOf('apply', plans).handle(interaction as never);
    expect(interaction.editReply.mock.calls).toHaveLength(1);
    expect(interaction.editReply.mock.calls[0][0]).not.toHaveProperty('flags');
    expect(textsOf(interaction.editReply.mock.calls[0][0].components)).toEqual(['❌ Action impossible (boom) [interaction-9]']);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it.each([
    ['une valeur jetée', 'échec', 'échec', 'échec'],
    ['un message trop long', new Error('x'.repeat(400)), 'x'.repeat(200), 'x'.repeat(300)],
  ] as const)('échec qui est %s : le texte est pris tel quel, coupé à 200 caractères dans la réponse et à 300 dans le journal', async (_label, thrown, shown, logged) => {
    const plans = fakePlans();
    plans.cancel.mockRejectedValue(thrown);
    const interaction = fakeInteraction({ customId: `plan:cancel~p=${PLAN}` });
    await handlerOf('cancel', plans).handle(interaction as never);
    expect(textsOf(interaction.reply.mock.calls[0][0].components)).toEqual([`❌ Action impossible (${shown}) [interaction-9]`]);
    expect(events.mock.calls).toEqual([['warn', 'action-plan', 'interaction_failed', { action: 'cancel', planId: PLAN, interactionId: 'interaction-9', error: logged }]]);
  });
});
