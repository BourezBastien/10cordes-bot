import { describe, expect, it } from 'vitest';
import { buildChatRequestBody, encodeApiTools } from './llm-request';
import type { ChatMessage, ChatOptions, OpenAiTool } from './llm.types';
import { toApiToolName } from './llm.utils';

const USER = '1550000000000000001';
const GUILD = '1550000000000000002';
// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

const tool = (id: string): OpenAiTool => ({
  type: 'function',
  function: { [NAME]: id, description: `tool ${id}`, parameters: { type: 'object', properties: { q: { type: 'string' } } } },
});

const options = (overrides: Partial<ChatOptions> = {}): ChatOptions => ({ userId: USER, guildId: null, cause: 'reply', ...overrides });

const input = (overrides: Partial<Parameters<typeof buildChatRequestBody>[0]> = {}) => ({
  model: 'test-model',
  messages: [{ role: 'user', content: 'bonjour' }] as ChatMessage[],
  apiTools: [] as OpenAiTool[],
  options: options(),
  reasoningEffort: null,
  ...overrides,
});

describe('buildChatRequestBody · champs optionnels OMIS (jamais envoyés à vide)', () => {
  it('sans tools ni effort : model, messages et user_id seulement', () => {
    expect(Object.keys(buildChatRequestBody(input()))).toEqual(['model', 'messages', 'user_id']);
  });

  it('reasoning_effort n\u0027apparaît que quand la décision le dit', () => {
    expect(buildChatRequestBody(input({ reasoningEffort: 'low' }))).toMatchObject({ reasoning_effort: 'low' });
    expect('reasoning_effort' in buildChatRequestBody(input({ reasoningEffort: null }))).toBe(false);
  });

  it('tools entraînent tool_choice, auto par défaut et none quand la synthèse est forcée', () => {
    expect(buildChatRequestBody(input({ apiTools: encodeApiTools([tool('a.b')]) }))).toMatchObject({
      tools: [{ function: { [NAME]: 'a__b' } }],
      tool_choice: 'auto',
    });
    expect(buildChatRequestBody(input({ apiTools: encodeApiTools([tool('a.b')]), options: options({ toolChoice: 'none' }) }))).toMatchObject({ tool_choice: 'none' });
  });

  it('stream : demande le flux et l\u0027usage en fin de réponse', () => {
    const body = buildChatRequestBody(input({ stream: true }));
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(buildChatRequestBody(input())).not.toHaveProperty('stream');
  });

  it('user_id désigne le serveur quand il existe, sinon l\u0027utilisateur', () => {
    expect(buildChatRequestBody(input({ options: options({ guildId: GUILD }) }))).toMatchObject({ user_id: GUILD });
    expect(buildChatRequestBody(input())).toMatchObject({ user_id: USER });
  });

  it('nettoie les surrogate pairs isolés et garde les emoji valides', () => {
    const body = buildChatRequestBody(
      input({
        messages: [
          { role: 'user', content: 'corrompu \uD83D' },
          { role: 'user', content: 'valide 😀' },
        ],
      }),
    );
    expect((body.messages as ChatMessage[]).map((message) => message.content)).toEqual(['corrompu ', 'valide 😀']);
  });
});

describe('encodeApiTools · noms de tools acceptés par l\u0027API', () => {
  it('remplace les points, conserve l\u0027ordre et le reste de la définition', () => {
    const [first, second] = encodeApiTools([tool('records.create'), tool('translate')]);
    expect(first?.function).toEqual({ [NAME]: 'records__create', description: 'tool records.create', parameters: { type: 'object', properties: { q: { type: 'string' } } } });
    expect(second?.function.name).toBe('translate');
    expect(toApiToolName('a.b.c')).toBe('a__b__c');
  });
});
