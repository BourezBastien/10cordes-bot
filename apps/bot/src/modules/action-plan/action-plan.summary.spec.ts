import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFileLog, type FileLogService } from '../logging/file-log.service';
import type { ChatCompletionResult } from '../assistant/llm.types';
import { cleanPlanSummary, PlanSummaryWriter } from './action-plan.summary';

const mocks = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock('../assistant/llm.accessor', () => ({ getLlm: () => ({ chatStream: mocks.chat }) }));

/**
 * Résumé d'un plan, écrit par le modèle quand le panneau se forme. Il aide le
 * demandeur à décider, il ne pilote rien : ce que le modèle écrit est affiché
 * nettoyé (aucune mention, aucun lien, aucune balise), plafonné, et jamais
 * conservé tel quel quand il sort du cadre.
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const ACTIONS = [
  { tool: 'renameChannel', input: { channelId: '1550000000000000003', name: 'général' } },
  { tool: 'setChannelTopic', input: { channelId: '1550000000000000003', topic: 'Accueil' } },
];
const INPUT = { guildId: GUILD, userId: USER, request: { content: 'renomme general et mets un sujet', locale: 'fr' }, actions: ACTIONS };

const completion = (content: string | null, toolCalls: ChatCompletionResult['toolCalls'] = []): ChatCompletionResult =>
  ({ content, reasoningContent: null, toolCalls, usage: { promptTokens: 4, completionTokens: 6 } }) as ChatCompletionResult;

beforeEach(() => {
  mocks.chat.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cleanPlanSummary', () => {
  it('un texte simple passe tel quel, blancs resserrés', () => {
    expect(cleanPlanSummary('  Je vais   renommer\nle salon. ')).toBe('Je vais renommer le salon.');
  });

  it('mentions, émojis personnalisés, liens et code sont retirés ; le reste du texte survit', () => {
    const cleaned = cleanPlanSummary(
      'Salut <@1550000000000000002> et <@&1550000000000000009> dans <#1550000000000000003> ! <a:wave:1550000000000000010> @everyone @here voyez https://exemple.test/piège?x=1 et [ceci](https://exemple.test) puis ```html<b>``` : je renomme le salon.',
    );
    expect(cleaned).toContain('je renomme le salon');
    for (const forbidden of ['<@', '<#', '<a:', '@everyone', '@here', 'exemple.test', 'ceci', '```', '<b>']) {
      expect(cleaned).not.toContain(forbidden);
    }
  });

  it('un dièse ou un arobase au milieu d\u0027un mot n\u0027efface pas la suite du texte ; une adresse reste telle quelle', () => {
    expect(cleanPlanSummary('Je renomme #général en #accueil et j\u0027écris à pierre@exemple.test pour prévenir.')).toBe(
      'Je renomme général en accueil et j\u0027écris à pierre@exemple.test pour prévenir.',
    );
    // Un pseudonyme précédé d\u0027un arobase, lui, disparaît.
    expect(cleanPlanSummary('Je préviens @pierre et @everyone ensuite.')).toBe('Je préviens et ensuite.');
  });

  it('plafonné à 600 caractères, sans mot coupé au milieu ni blanc final', () => {
    const words = Array.from({ length: 200 }, (_, index) => `mot${index}`).join(' ');
    const cleaned = cleanPlanSummary(words);
    expect(cleaned.length).toBeLessThanOrEqual(600);
    expect(cleaned.endsWith(' ')).toBe(false);
    expect(words.startsWith(cleaned)).toBe(true);
  });

  it('un texte réduit à des mentions rend vide', () => {
    expect(cleanPlanSummary('<@1550000000000000002> @everyone https://exemple.test')).toBe('');
  });
});

describe('PlanSummaryWriter', () => {
  /** Journal factice : les lignes LLM sont conservées. */
  function journal() {
    const lines: Array<Record<string, unknown>> = [];
    const log: Pick<FileLogService, 'event' | 'llm'> = {
      event: vi.fn(),
      llm: (entry) => {
        lines.push(entry as unknown as Record<string, unknown>);
      },
    };
    setFileLog(log as FileLogService);
    return lines;
  }

  afterEach(() => {
    setFileLog(null);
  });

  it('le modèle reçoit la demande et la liste des actions, sans outil, et son texte est gardé nettoyé', async () => {
    mocks.chat.mockResolvedValue(completion('Je vais renommer le salon en général **et** lui donner un sujet. @everyone'));
    const summary = await new PlanSummaryWriter().write(INPUT);
    expect(summary).toBe('Je vais renommer le salon en général et lui donner un sujet.');
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    const [messages, tools, options] = mocks.chat.mock.calls[0];
    expect(tools).toEqual([]);
    expect(options).toMatchObject({ userId: USER, guildId: GUILD, cause: 'reply', preferReasoning: false });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('aucune action de plus');
    expect(messages[1].content).toContain('« renomme general et mets un sujet »');
    expect(messages[1].content).toContain('1. renameChannel(channelId=1550000000000000003, name=général)');
    expect(messages[1].content).toContain('2. setChannelTopic(');
  });

  it('sans action, aucun appel', async () => {
    expect(await new PlanSummaryWriter().write({ ...INPUT, actions: [] })).toBeNull();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('un modèle qui appelle un outil ou ne dit rien ne fournit pas de résumé', async () => {
    mocks.chat.mockResolvedValue(completion('texte', [{ id: 'c1', name: 'renameChannel', arguments: '{}' }]));
    expect(await new PlanSummaryWriter().write(INPUT)).toBeNull();
    mocks.chat.mockResolvedValue(completion('   '));
    expect(await new PlanSummaryWriter().write(INPUT)).toBeNull();
  });

  it('une erreur du modèle (indisponible, clé refusée) laisse le panneau s\u0027afficher sans résumé', async () => {
    const lines = journal();
    mocks.chat.mockRejectedValue(new Error('clé rejetée'));
    await expect(new PlanSummaryWriter().write(INPUT)).resolves.toBeNull();
    // L'appel raté entre quand même dans le journal des coûts.
    expect(lines).toEqual([expect.objectContaining({ cause: 'plan.summary', ok: false, error: 'Error: clé rejetée', guildId: GUILD })]);
  });

  it('au-delà de douze secondes, le panneau n\u0027attend pas : pas de résumé', async () => {
    vi.useFakeTimers();
    mocks.chat.mockImplementation(() => new Promise<ChatCompletionResult>(() => undefined));
    const outcome = new PlanSummaryWriter().write(INPUT);
    await vi.advanceTimersByTimeAsync(12_001);
    await expect(outcome).resolves.toBeNull();
  });

  it('l\u0027appel entre dans le journal des coûts, sous la cause plan.summary', async () => {
    const lines = journal();
    mocks.chat.mockResolvedValue({ ...completion('Je vais renommer le salon.'), served: { provider: 'deepseek-official', model: 'deepseek-flash', capability: 'chat.default', fallback: false } });
    await new PlanSummaryWriter().write(INPUT);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      cause: 'plan.summary',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      capability: 'chat.default',
      promptTokens: 4,
      completionTokens: 6,
      ok: true,
      guildId: GUILD,
    });
  });
});
