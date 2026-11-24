import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatOptions, OpenAiTool } from '../../../shared/llm/chat-contract';
import type { ChatTurnInput } from '../provider.types';
import { fromAnthropicResponse, toAnthropicRequest } from './anthropic-messages.translate';

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

const tool = (id: string): OpenAiTool => ({ type: 'function', function: { [NAME]: id, description: `outil ${id}`, parameters: { type: 'object', properties: { q: { type: 'string' } } } } });
const call = (id: string, fn: string, args = '{}') => ({ id, type: 'function' as const, function: { [NAME]: fn, arguments: args } });
const options: ChatOptions = { userId: 'u1', guildId: 'g1', cause: 'reply' };
const turn = (messages: ChatMessage[], overrides: Partial<ChatTurnInput> = {}): ChatTurnInput => ({ modelId: 'claude-test', messages, tools: [], options, ...overrides });
const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] });

describe('toAnthropicRequest · messages', () => {
  it('les messages system remontent en blocs texte de system, les vides sont omis', () => {
    const body = toAnthropicRequest(turn([{ role: 'system', content: 'règles' }, { role: 'system', content: '  ' }, { role: 'system', content: 'ton' }, { role: 'user', content: 'bonjour' }]), 1024);
    expect(body).toEqual({
      model: 'claude-test',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'règles' }, { type: 'text', text: 'ton' }],
      messages: [user('bonjour')],
    });
  });

  it('sans message system ni outil, seuls model, max_tokens et messages partent', () => {
    const body = toAnthropicRequest(turn([{ role: 'user', content: 'bonjour' }]), 512);
    expect(Object.keys(body)).toEqual(['model', 'max_tokens', 'messages']);
    expect(body.max_tokens).toBe(512);
  });

  it('deux messages consécutifs de même rôle sont fusionnés (l\u0027API exige l\u0027alternance)', () => {
    const body = toAnthropicRequest(
      turn([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'x' },
        { role: 'assistant', content: 'y' },
        { role: 'user', content: 'c' },
      ]),
      100,
    );
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] },
      user('c'),
    ]);
  });

  it('aller-retour des outils : tool_calls en tool_use, chaque message tool en tool_result d\u0027un même user', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'météo ?' },
      { role: 'assistant', content: '', tool_calls: [call('c1', 'web.search', '{"q":"Paris"}'), call('c2', 'records.create', 'pas du json')] },
      { role: 'tool', content: '18 °C', tool_call_id: 'c1' },
      { role: 'tool', content: '', tool_call_id: 'c2' },
      { role: 'user', content: 'merci' },
    ];
    expect(toAnthropicRequest(turn(messages), 100).messages).toEqual([
      user('météo ?'),
      {
        role: 'assistant',
        // Pas de bloc texte vide à côté des tool_use.
        content: [
          { type: 'tool_use', id: 'c1', [NAME]: 'web__search', input: { q: 'Paris' } },
          { type: 'tool_use', id: 'c2', [NAME]: 'records__create', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: '18 °C' },
          { type: 'tool_result', tool_use_id: 'c2', content: '(sans résultat)' },
          { type: 'text', text: 'merci' },
        ],
      },
    ]);
  });

  it('un tour assistant avec texte et appels garde son texte AVANT les tool_use', () => {
    const body = toAnthropicRequest(turn([{ role: 'user', content: 'go' }, { role: 'assistant', content: 'Je cherche.', tool_calls: [call('c1', 'web.search')] }]), 100);
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Je cherche.' }, { type: 'tool_use', id: 'c1', [NAME]: 'web__search', input: {} }] });
  });

  it('un tour assistant sans texte ni appel reçoit le marqueur (suite)', () => {
    const body = toAnthropicRequest(turn([{ role: 'user', content: 'a' }, { role: 'assistant', content: '   ' }]), 100);
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '(suite)' }] });
  });

  it('un message user vide est omis plutôt que d\u0027envoyer un bloc texte vide', () => {
    const body = toAnthropicRequest(turn([{ role: 'user', content: 'a' }, { role: 'user', content: '' }]), 100);
    expect(body.messages).toEqual([user('a')]);
  });

  it('la conversation s\u0027ouvre toujours par user : marqueur (début) sinon, y compris sur un historique vide', () => {
    const body = toAnthropicRequest(turn([{ role: 'assistant', content: 'x' }, { role: 'user', content: 'a' }]), 100);
    expect(body.messages).toEqual([user('(début)'), { role: 'assistant', content: [{ type: 'text', text: 'x' }] }, user('a')]);
    expect(toAnthropicRequest(turn([]), 100).messages).toEqual([user('(début)')]);
    expect(toAnthropicRequest(turn([{ role: 'system', content: 'seul' }]), 100).messages).toEqual([user('(début)')]);
  });

  it('un résultat d\u0027outil sans identifiant d\u0027appel est refusé avant l\u0027envoi', () => {
    expect(() => toAnthropicRequest(turn([{ role: 'tool', content: 'orphelin' }]), 100)).toThrow(expect.objectContaining({ kind: 'invalid' }));
  });
});

describe('toAnthropicRequest · tools', () => {
  const history: ChatMessage[] = [{ role: 'user', content: 'go' }];

  it('noms encodés (points interdits), input_schema, tool_choice auto', () => {
    const body = toAnthropicRequest(turn(history, { tools: [tool('records.create'), tool('web.search')] }), 100);
    expect(body.tools).toEqual([
      { [NAME]: 'records__create', description: 'outil records.create', input_schema: { type: 'object', properties: { q: { type: 'string' } } } },
      { [NAME]: 'web__search', description: 'outil web.search', input_schema: { type: 'object', properties: { q: { type: 'string' } } } },
    ]);
    expect(body.tool_choice).toEqual({ type: 'auto' });
  });

  it('synthèse forcée (toolChoice none) : ni tools ni tool_choice ne partent', () => {
    const body = toAnthropicRequest(turn(history, { tools: [tool('records.create')], options: { ...options, toolChoice: 'none' } }), 100);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('sans outil, pas de tool_choice', () => {
    const body = toAnthropicRequest(turn(history), 100);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });
});

describe('fromAnthropicResponse', () => {
  it('les blocs text sont concaténés, chaque tool_use devient un appel (nom décodé, arguments sérialisés), l\u0027usage est converti', () => {
    const result = fromAnthropicResponse({
      content: [{ type: 'text', text: 'Bonjour' }, { type: 'text', text: ' !' }, { type: 'tool_use', id: 'toolu_1', [NAME]: 'records__create', input: { q: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    expect(result).toEqual({
      content: 'Bonjour !',
      reasoningContent: null,
      toolCalls: [{ id: 'toolu_1', [NAME]: 'records.create', arguments: '{"q":"x"}' }],
      usage: { promptTokens: 12, completionTokens: 3 },
    });
  });

  it('sans texte ni usage : contenu null et pas d\u0027usage', () => {
    const result = fromAnthropicResponse({ content: [{ type: 'tool_use', id: 'toolu_2', [NAME]: 'web__search', input: {} }], usage: { input_tokens: 0, output_tokens: 7 } });
    expect(result.toolCalls).toEqual([{ id: 'toolu_2', [NAME]: 'web.search', arguments: '{}' }]);
    expect(result.content).toBeNull();
    expect(fromAnthropicResponse({ content: [] })).not.toHaveProperty('usage');
    expect(fromAnthropicResponse(null)).toEqual({ content: null, reasoningContent: null, toolCalls: [] });
  });
});
