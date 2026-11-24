import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@10cordes/shared';
import { buildTriggerTools } from './surface-trigger.tools';

/**
 * trigger.schedule : le pipeline planifié s'exécutera plus tard, avec ses
 * propres étapes seulement. Une référence `{{steps.N...}}` fausse y deviendrait
 * une chaîne vide, sans erreur : elle est refusée avant l'enregistrement.
 */

const GUILD = '1550835980116824136';
const USER = '1550000000000000003';

function deps() {
  return {
    prisma: {
      interactiveSurface: { create: vi.fn(), findUnique: vi.fn() },
      scheduledTrigger: { create: vi.fn().mockResolvedValue({ id: 'trigger-1' }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    },
    audit: { record: vi.fn() },
    store: {},
    render: vi.fn(async () => undefined),
    nextCron: vi.fn((): Date | null => null),
  };
}

const ctx = (): ToolRunContext => ({ guildId: GUILD, channelId: null, userId: USER, locale: 'fr', permissions: ['ManageGuild'], reply: async () => undefined });

/** trigger.schedule est le premier tool de la factory (ordre d'enregistrement documenté). */
const schedule = (d: ReturnType<typeof deps>, steps: unknown) => buildTriggerTools(d as never)[0]?.handler({ delaySec: 60, steps: JSON.stringify(steps) }, ctx());

describe('trigger.schedule · références d\u0027étape du pipeline planifié', () => {
  it('un pipeline qui lit ses propres étapes est armé', async () => {
    const d = deps();
    const result = await schedule(d, [{ type: 'sendMessage', content: 'patience' }, { type: 'replyEphemeral', content: 'envoyé : {{steps.0.sent}}' }]);
    expect(result?.ok).toBe(true);
    expect(d.prisma.scheduledTrigger.create).toHaveBeenCalledTimes(1);
  });

  it('{{steps.0.data.x}} est refusé avant l\u0027enregistrement', async () => {
    const d = deps();
    const result = await schedule(d, [{ type: 'runTool', name: 'createChannel', input: {} }, { type: 'sendMessage', content: '<#{{steps.0.data.channelId}}>' }]);
    expect(result?.ok).toBe(false);
    expect(result?.summary).toBe(
      'Steps refusés : {{steps.0.data.channelId}} dans content, pipeline planifié, étape 2 (sendMessage) : le résultat d\u0027un outil se lit sans `data` : le champ se met directement après le numéro. Ce pipeline s\u0027exécutera avec ses propres étapes seulement.',
    );
    expect(d.prisma.scheduledTrigger.create).not.toHaveBeenCalled();
  });

  it('deux références fautives sont listées côte à côte', async () => {
    const d = deps();
    const result = await schedule(d, [{ type: 'sendMessage', content: '{{steps.2.channelId}} puis {{steps.1.roleId}}' }]);
    expect(result?.ok).toBe(false);
    expect(result?.summary).toContain(' | {{steps.1.roleId}} dans content');
    expect(d.prisma.scheduledTrigger.create).not.toHaveBeenCalled();
  });
});
