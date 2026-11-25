import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ llmChat: vi.fn() }));

vi.mock('../assistant/llm.accessor', () => ({
  getLlm: () => ({ chat: mocks.llmChat }),
}));

import { MemoryCuratorService } from './memory-curator.service';

type Correction = { oldFact: string; newFact: string };

/** `corrections` : les corrections actives que la base rend pour la fiche. */
function makeCurator(currentText: string | null = null, corrections: Correction[] = []) {
  const prisma = {
    memberMemoryProfile: {
      findUnique: vi.fn().mockResolvedValue(currentText === null ? null : { text: currentText }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    guildMemoryProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    agentSkill: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    memoryCorrection: {
      findMany: vi.fn().mockResolvedValue(corrections),
    },
  };
  const audit = { record: vi.fn() };
  const curator = new MemoryCuratorService(prisma as never, audit as never);
  return { curator, prisma, audit };
}

const ok = (text: string) => JSON.stringify({ decision: 'appended', reason: '', text });
const reply = (content: string) => ({ content, reasoningContent: null, toolCalls: [] });
const systemPromptOf = (call: number) => String((mocks.llmChat.mock.calls[call] as unknown as [Array<{ content: string }>, unknown])[0][0]?.content);
const LILLE: Correction = { oldFact: 'habite à Lille', newFact: 'habite à Lyon' };
const LINE = 'CORRIGÉ : habite à Lyon (ne plus dire : habite à Lille)';

describe('MemoryCuratorService', () => {
  it('fusionne un fait valide et upsert la fiche', async () => {
    mocks.llmChat.mockResolvedValue({
      content: ok('Fiche : <@123> aime les pizzas.'),
      reasoningContent: null,
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'aime les pizzas');
    expect(result.status).toBe('appended');
    expect(prisma.memberMemoryProfile.upsert).toHaveBeenCalledTimes(1);
    // Le fait rapporté est enveloppé dans une zone <donnees> (anti-injection).
    const call = mocks.llmChat.mock.calls[0] as unknown as [unknown[], unknown, { cause: string }];
    expect(call[2].cause).toBe('consolidation');
    expect(JSON.stringify(call[0])).toContain('<donnees>');
  });

  it('rejette une fiche dépassant le budget de 2000 caractères', async () => {
    mocks.llmChat.mockResolvedValue({ content: ok('x'.repeat(2100)), reasoningContent: null, toolCalls: [] });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('rejected');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('anti-wipe : refus si la fusion réduit la fiche de plus de 50 %', async () => {
    mocks.llmChat.mockResolvedValue({ content: ok('Fiche réduite : <@123>.'), reasoningContent: null, toolCalls: [] });
    const { curator, prisma } = makeCurator('a'.repeat(500));
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('anti-wipe');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejette une fiche membre qui ne référence pas le sujet', async () => {
    mocks.llmChat.mockResolvedValue({ content: ok('Fiche sans mention du sujet.'), reasoningContent: null, toolCalls: [] });
    const { curator } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('référence');
  });

  it('respecte le refus explicite du conservateur', async () => {
    mocks.llmChat.mockResolvedValue({
      content: JSON.stringify({ decision: 'rejected', reason: 'fait anecdotique', text: 'Fiche : <@123>.' }),
      reasoningContent: null,
      toolCalls: [],
    });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait anecdotique');
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('fait anecdotique');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('unconsolidated si le LLM échoue (le journal brut reste la source)', async () => {
    mocks.llmChat.mockRejectedValue(new Error('timeout'));
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('unconsolidated');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('la fusion serveur upsert GuildMemoryProfile sans contrainte de sujet', async () => {
    mocks.llmChat.mockResolvedValue({
      content: ok('Le serveur applique la règle : pas de spoilers.'),
      reasoningContent: null,
      toolCalls: [],
    });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateGuild('g1', '456', 'pas de spoilers');
    expect(result.status).toBe('appended');
    expect(prisma.guildMemoryProfile.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.llmChat.mock.calls[0] as unknown as [unknown[], unknown, { cause: string }];
    expect(call[2].cause).toBe('consolidation');
  });
});

describe('MemoryCuratorService · corrections qui tiennent', () => {
  it('une fusion qui porte une correction l\u0027annonce au modèle', async () => {
    mocks.llmChat.mockResolvedValue(reply(ok('<@123> habite à Lyon.')));
    const { curator } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'habite à Lyon', LILLE);
    expect(result.status).toBe('appended');
    expect(systemPromptOf(0)).toContain('Cette fusion est une CORRECTION');
  });

  it('si la fusion laisse l\u0027ancien fait, la forme corrigée est réécrite dans la fiche', async () => {
    mocks.llmChat.mockResolvedValue(reply(ok('<@123> habite à Lille depuis 2020.')));
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'habite à Lyon', LILLE);
    expect(result.text).toBe(`<@123> habite à Lille depuis 2020.\n${LINE}`);
    expect(prisma.memberMemoryProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { text: `<@123> habite à Lille depuis 2020.\n${LINE}` } }));
  });

  it('une fusion qui a bien appliqué la correction n\u0027est pas touchée', async () => {
    mocks.llmChat.mockResolvedValue(reply(ok('<@123> habite à Lyon depuis 2024.')));
    const { curator } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'habite à Lyon', LILLE);
    expect(result.text).toBe('<@123> habite à Lyon depuis 2024.');
  });

  it('les corrections actives sont annoncées à CHAQUE fusion, et une fusion qui les contredit est réécrite', async () => {
    // Un fait sans rapport, mais la fusion rendue redit l'ancien fait : la correction s'impose quand même.
    mocks.llmChat.mockResolvedValue(reply(ok('<@123> aime les pizzas. Il habite à Lille.')));
    const { curator } = makeCurator(null, [LILLE]);
    const result = await curator.consolidateMember('g1', '123', '456', 'aime les pizzas');
    expect(result.text).toBe(`<@123> aime les pizzas. Il habite à Lille.\n${LINE}`);
    expect(systemPromptOf(0)).toContain('FAITS CORRIGÉS (ils priment)');
    expect(systemPromptOf(0)).toContain(LINE);
  });

  it('sans correction connue, la fusion ne reçoit aucune règle de correction', async () => {
    mocks.llmChat.mockResolvedValue(reply(ok('<@123> habite à Lille.')));
    const { curator } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'habite à Lille');
    expect(result.text).toBe('<@123> habite à Lille.');
    expect(systemPromptOf(0)).not.toContain('CORRIGÉ');
  });
});
