import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@10cordes/shared';
import { AgentLoopService, ceilingMessage } from './agent-loop.service';
import { LlmFormatLeakError } from './llm.errors';
import type { ChatCompletionResult, ChatMessage, ChatOptions, OpenAiTool } from './llm.types';

/**
 * Boucle LLM + tools. Trois garanties fixées ici, chacune née d'un incident
 * réel : l'effort de raisonnement ne bascule pas en cours de requête, un tour
 * qui fuit ses balises internes est rejoué proprement, et le plafond
 * d'itérations se termine par un message honnête, jamais par du texte brut.
 * La boucle ne publie rien : seul le texte du dernier tour est rendu.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
const TOOL = 'test.ping';

const tool = (id: string): OpenAiTool => ({ type: 'function', function: { [NAME]: id, description: `tool ${id}`, parameters: { type: 'object', properties: {} } } });

const completion = (content: string | null, calls: Array<{ id: string; tool: string }> = []): ChatCompletionResult => ({
  content,
  reasoningContent: null,
  toolCalls: calls.map((call) => ({ id: call.id, name: call.tool, arguments: '{}' })),
  usage: { promptTokens: 1, completionTokens: 1 },
});

interface Turn {
  messages: ChatMessage[];
  /** Outils proposés au modèle pour ce tour. */
  tools: OpenAiTool[];
  options: ChatOptions;
  callbacks: { onDelta?: (text: string) => void; toolChoice?: 'auto' | 'none' };
}

type Step = (turn: Turn) => Promise<ChatCompletionResult>;

/** Client LLM factice : chaque appel consomme une étape du scénario. */
function fakeLlm(script: Step[], plannedEffort: string | null = 'low') {
  const calls: Turn[] = [];
  const chatStream = vi.fn(async (messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions, callbacks: Turn['callbacks']): Promise<ChatCompletionResult> => {
    const turn = { messages, tools: [...tools], options, callbacks };
    calls.push(turn);
    const step = script.shift();
    if (!step) throw new Error('appel LLM non prévu par le scénario');
    return step(turn);
  });
  const planRequest = vi.fn(async (_options: Pick<ChatOptions, 'userId' | 'guildId' | 'cause'>, actionIntent: boolean) => ({
    reasoningEffort: plannedEffort,
    preferReasoning: actionIntent,
  }));
  return { llm: { chatStream, planRequest }, calls, chatStream, planRequest };
}

const toolTurn = (id: string): Step => async () => completion('', [{ id, tool: TOOL }]);
const textTurn = (text: string): Step => async ({ callbacks }) => {
  callbacks.onDelta?.(text);
  return completion(text);
};
/** Un tour qui stream du texte puis laisse fuir ses balises internes. */
const leakingTurn = (): Step => async ({ callbacks }) => {
  callbacks.onDelta?.('partiel ');
  throw new LlmFormatLeakError('<|tool_call|>');
};

const ctx = (): ToolRunContext => ({ guildId: null, channelId: null, userId: '1550000000000000001', locale: 'fr', permissions: [], reply: async () => undefined });
const toolset = () => ({ active: [tool(TOOL)], byName: new Map([[TOOL, tool(TOOL)]]) });
const hooks = () => ({ cause: 'reply' as const, quotaExhaustedMessage: 'quota' });
const registry = () => ({
  run: vi.fn<() => Promise<{ ok: boolean; summary: string; data?: unknown }>>(async () => ({ ok: true, summary: 'ok' })),
});

const ceilingScript = (last: Step): Step[] => [...Array.from({ length: 12 }, () => toolTurn(`call-${Math.random()}`)), last];

describe('AgentLoopService · une recette ouverte rend ses tools appelables', () => {
  const catalog = () =>
    new Map([
      [TOOL, tool(TOOL)],
      ['surface.create', tool('surface.create')],
      ['surface.patchState', tool('surface.patchState')],
    ]);

  it('openSkill élargit le toolset : plus de search_tools tour par tour pour chaque tool de la recette', async () => {
    const registryMock = registry();
    registryMock.run.mockResolvedValue({ ok: true, summary: 'ouvert', data: { tools: [{ [NAME]: 'surface.create' }, { [NAME]: 'surface.patchState' }] } });
    const { llm, calls } = fakeLlm([async () => completion('', [{ id: 'c1', tool: 'openSkill' }]), textTurn('Panneau créé.')]);
    await new AgentLoopService(llm as never, registryMock as never).run([], { active: [tool(TOOL)], byName: catalog() }, ctx(), { userId: '1', guildId: null }, hooks());
    expect(calls[0]?.tools.map((entry) => entry.function.name)).toEqual([TOOL]);
    expect(calls[1]?.tools.map((entry) => entry.function.name)).toEqual([TOOL, 'surface.create', 'surface.patchState']);
  });

  it('un tool annoncé mais absent du catalogue est ignoré', async () => {
    const registryMock = registry();
    registryMock.run.mockResolvedValue({ ok: true, summary: 'trouvé', data: { tools: [{ [NAME]: 'tool.fantome' }] } });
    const { llm, calls } = fakeLlm([async () => completion('', [{ id: 'c1', tool: 'search_tools' }]), textTurn('ok')]);
    await new AgentLoopService(llm as never, registryMock as never).run([], { active: [tool(TOOL)], byName: catalog() }, ctx(), { userId: '1', guildId: null }, hooks());
    expect(calls[1]?.tools.map((entry) => entry.function.name)).toEqual([TOOL]);
  });
});

describe('AgentLoopService · effort de raisonnement stable', () => {
  it('effort et capacité de conversation se décident UNE fois avant le premier tour et restent identiques sur tous les tours', async () => {
    const { llm, calls, planRequest } = fakeLlm([toolTurn('c1'), toolTurn('c2'), textTurn('Fait.')]);
    const outcome = await new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1550000000000000001', guildId: '1550835980116824136' }, hooks());
    expect(outcome.finalText).toBe('Fait.');
    expect(planRequest).toHaveBeenCalledTimes(1);
    expect(planRequest).toHaveBeenCalledWith({ userId: '1550000000000000001', guildId: '1550835980116824136', cause: 'reply' }, true);
    expect(calls.map((call) => call.options.reasoningEffort)).toEqual(['low', 'low', 'low']);
    expect(calls.map((call) => call.options.preferReasoning)).toEqual([true, true, true]);
  });

  it('respecte le plan décidé par l\u0027appelant, même désactivé (null)', async () => {
    const { llm, calls, planRequest } = fakeLlm([textTurn('Bonjour')]);
    await new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1', guildId: null, reasoningEffort: null, preferReasoning: false }, hooks());
    expect(planRequest).not.toHaveBeenCalled();
    expect(calls[0]?.options.reasoningEffort).toBeNull();
    expect(calls[0]?.options.preferReasoning).toBe(false);
  });
});

describe('AgentLoopService · fuite de balises internes', () => {
  it('un tour qui fuit est rejoué une fois, sans garder le texte partiel du premier essai', async () => {
    const { llm } = fakeLlm([leakingTurn(), textTurn('Réponse propre')]);
    const outcome = await new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1', guildId: null }, hooks());
    expect(outcome.finalText).toBe('Réponse propre');
  });

  it('deux fuites de suite font échouer la requête avec l\u0027erreur typée', async () => {
    const { llm } = fakeLlm([leakingTurn(), leakingTurn()]);
    await expect(new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1', guildId: null }, hooks())).rejects.toBeInstanceOf(LlmFormatLeakError);
  });
});

describe('AgentLoopService · plafond d\u0027itérations', () => {
  it('le dernier tour n\u0027est pas bridé par tool_choice none : il est relancé par un message', async () => {
    const { llm, calls } = fakeLlm(ceilingScript(textTurn('Résumé.')));
    const outcome = await new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1', guildId: null }, hooks());
    expect(outcome.forcedSummary).toBe(true);
    expect(outcome.finalText).toBe('Résumé.');
    expect(calls).toHaveLength(13);
    expect(calls[12]?.callbacks.toolChoice).toBeUndefined();
    expect(calls[12]?.options.reasoningEffort).toBe('low');
    const last = calls[12]?.messages[calls[12].messages.length - 1];
    expect(last?.role).toBe('user');
    expect(last?.content).toContain('N\u0027appelle plus aucun outil');
  });

  it('un dernier tour qui appelle encore un outil est ignoré : message honnête, et rien du tour n\u0027est livré', async () => {
    const { llm } = fakeLlm(ceilingScript(toolTurn('trop-tard')));
    const outcome = await new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1', guildId: null }, hooks());
    expect(outcome.forcedSummary).toBe(true);
    expect(outcome.finalText).toBe(ceilingMessage(outcome.executed));
    expect(outcome.finalText).toContain('n\u0027est pas terminée');
  });

  it('un dernier tour qui fuit ses balises ne livre rien d\u0027autre que le message honnête', async () => {
    const { llm } = fakeLlm(ceilingScript(leakingTurn()));
    const outcome = await new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1', guildId: null }, hooks());
    expect(outcome.finalText).toBe(ceilingMessage(outcome.executed));
  });

  it('le texte d\u0027un tour à tool_calls n\u0027est jamais la réponse : seul le dernier tour, sans tool_calls, l\u0027est', async () => {
    const { llm } = fakeLlm([async () => completion('Je vais créer le salon...', [{ id: 'c1', tool: TOOL }]), textTurn('Salon créé.')]);
    const outcome = await new AgentLoopService(llm as never, registry() as never).run([], toolset(), ctx(), { userId: '1', guildId: null }, hooks());
    expect(outcome.finalText).toBe('Salon créé.');
    expect(outcome.executed).toEqual([TOOL]);
  });
});

describe('ceilingMessage', () => {
  it('dit ce qui a été fait et comment reprendre, sans prétendre que c\u0027est terminé', () => {
    const text = ceilingMessage(['surface.create', 'surface.create', 'trigger.schedule']);
    expect(text).toContain('3 action(s)');
    expect(text).toContain('surface.create, trigger.schedule');
    expect(text).toContain('« continue »');
    expect(text).not.toContain('Terminé');
  });

  it('sans action, invite à reformuler', () => {
    expect(ceilingMessage([])).toContain('Reformule');
  });
});
