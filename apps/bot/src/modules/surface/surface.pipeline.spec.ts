import { describe, expect, it, vi } from 'vitest';
import type { GuildMember } from 'discord.js';
import type { PipelineContext, PipelineVars } from './pipeline.types';

const mocks = vi.hoisted(() => ({ chat: vi.fn() }));

vi.mock('../assistant/llm.accessor', () => ({ getLlm: () => ({ chat: mocks.chat }) }));

import { SurfacePipelineService } from './surface.pipeline';

/**
 * Exécution des pipelines. Un jeu comme le blackjack a besoin de deux
 * capacités que le moteur n'avait pas : ranger dans l'état le résultat d'une
 * étape (le tirage d'un random, le JSON rendu par le LLM), et le re-rendu
 * montre ensuite cet état dans les textes.
 */

const GUILD = '1550835980116824136';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';

const service = () => new SurfacePipelineService({} as never, { record: vi.fn() } as never, {} as never, {} as never);

const context = (state: Record<string, unknown> = {}): PipelineContext => {
  const vars: PipelineVars = { guildId: GUILD, channelId: CHANNEL, actorId: USER, actorName: 'Paul', surfaceId: 'surface-1', messageId: null, state, steps: [], values: {} };
  return { vars, runTool: vi.fn(), member: null };
};

describe('SurfacePipelineService · setState avec référence', () => {
  it('le tirage d\u0027un random est rangé dans l\u0027état comme NOMBRE, et l\u0027état est marqué modifié', async () => {
    const ctx = context();
    const result = await service().executePipeline(
      [
        { type: 'random', min: 1, max: 11 },
        { type: 'setState', path: 'game.card', value: '{{steps.0.value}}', mode: 'set' },
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.stateChanged).toBe(true);
    const card = (ctx.vars.state.game as { card: number }).card;
    expect(typeof card).toBe('number');
    expect(card).toBeGreaterThanOrEqual(1);
    expect(card).toBeLessThanOrEqual(11);
  });

  it('une valeur fixe reste inchangée, un incrément à partir d\u0027une référence compte', async () => {
    const ctx = context({ compteurs: { tours: 3 } });
    await service().executePipeline(
      [
        { type: 'setState', path: 'phase', value: 'jouee', mode: 'set' },
        { type: 'setState', path: 'compteurs.tours', value: '{{steps.0.value}}', mode: 'increment' },
      ],
      ctx,
    );
    expect(ctx.vars.state.phase).toBe('jouee');
  });
});

describe('SurfacePipelineService · étape llm avec saveTo', () => {
  it('le JSON du modèle, même noyé dans du texte, devient un OBJET de l\u0027état', async () => {
    mocks.chat.mockResolvedValue({ content: 'Voici la donne : {"hand":"A♠ 7♦","dealer":"R♣","total":17,"coins":90} Bonne chance !' });
    const ctx = context();
    const result = await service().executePipeline(
      [{ type: 'llm', prompt: 'Tu es la banque. Réponds en JSON.', maxChars: 400, saveTo: 'game', parseJson: true }],
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(ctx.vars.state.game).toEqual({ hand: 'A♠ 7♦', dealer: 'R♣', total: 17, coins: 90 });
    expect(ctx.vars.steps[0]?.text).toContain('"total":17');
    expect(mocks.chat).toHaveBeenCalledTimes(1);
  });

  it('sans parseJson, le texte est rangé tel quel', async () => {
    mocks.chat.mockResolvedValue({ content: 'Manche terminée, tu gagnes 10 jetons.' });
    const ctx = context();
    const result = await service().executePipeline([{ type: 'llm', prompt: 'Résume.', maxChars: 200, saveTo: 'message', parseJson: false }], ctx);
    expect(result.stateChanged).toBe(true);
    expect(ctx.vars.state.message).toBe('Manche terminée, tu gagnes 10 jetons.');
  });

  it('un JSON invalide est rangé comme texte, jamais comme plantage', async () => {
    mocks.chat.mockResolvedValue({ content: 'je ne peux pas répondre en JSON' });
    const ctx = context();
    const result = await service().executePipeline([{ type: 'llm', prompt: 'JSON ?', maxChars: 200, saveTo: 'game', parseJson: true }], ctx);
    expect(result.ok).toBe(true);
    expect(ctx.vars.state.game).toBe('je ne peux pas répondre en JSON');
  });

  it('sans saveTo, l\u0027étape ne touche pas à l\u0027état', async () => {
    mocks.chat.mockResolvedValue({ content: 'juste une reformulation' });
    const ctx = context();
    const result = await service().executePipeline([{ type: 'llm', prompt: 'Reformule.', maxChars: 200 }], ctx);
    expect(result.stateChanged).toBe(false);
    expect(ctx.vars.state).toEqual({});
    expect(ctx.vars.steps[0]?.text).toBe('juste une reformulation');
  });
});

describe('SurfacePipelineService · étape sendMessage et mentions de masse', () => {
  const member = (permissions: string[], bot = false): GuildMember =>
    ({
      id: bot ? 'bot' : USER,
      user: { bot },
      guild: { id: GUILD, ownerId: 'owner' },
      permissions: { toArray: () => permissions, has: () => false },
      roles: { cache: new Map() },
    }) as unknown as GuildMember;

  /** Exécute une étape sendMessage pour un acteur donné ; rend ce que le salon a reçu. */
  const announce = async (actor: GuildMember | null) => {
    const send = vi.fn(async () => ({ id: 'message-1' }));
    const channel = { id: CHANNEL, isTextBased: () => true, send };
    const service = new SurfacePipelineService({} as never, { record: vi.fn() } as never, {} as never, { channels: { fetch: vi.fn(async () => channel) } } as never);
    const vars: PipelineVars = { guildId: GUILD, channelId: CHANNEL, actorId: actor?.id ?? USER, actorName: 'Paul', surfaceId: 'surface-1', messageId: null, state: {}, steps: [], values: {} };
    const result = await service.executePipeline([{ type: 'sendMessage', content: 'Soirée @Everyone à 21 h' }], { vars, runTool: vi.fn(), member: actor });
    return { send, result };
  };

  it('le texte a été écrit par le modèle : sans acteur (événement), la mention de masse est neutralisée', async () => {
    const { send, result } = await announce(null);
    expect(result).toMatchObject({ ok: true, stateChanged: false });
    expect(send).toHaveBeenCalledWith({ content: 'Soirée `Everyone` à 21 h' });
  });

  it('un déclencheur planifié s\u0027exécute en tant que le bot : ça ne compte pas comme un administrateur', async () => {
    const { send } = await announce(member(['Administrator'], true));
    expect(send).toHaveBeenCalledWith({ content: 'Soirée `Everyone` à 21 h' });
  });

  it('un membre sans le droit, puis un administrateur au clic', async () => {
    expect((await announce(member(['SendMessages']))).send).toHaveBeenCalledWith({ content: 'Soirée `Everyone` à 21 h' });
    expect((await announce(member(['Administrator']))).send).toHaveBeenCalledWith({ content: 'Soirée @Everyone à 21 h' });
  });
});
