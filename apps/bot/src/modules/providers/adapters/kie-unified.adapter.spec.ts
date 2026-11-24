import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFallbackEligible, ProviderError, type ProviderConfig, type ProviderRequest } from '../provider.types';
import type { ChatMessage, ChatOptions, OpenAiTool } from '../../../shared/llm/chat-contract';
import { KieUnifiedAdapter } from './kie-unified.adapter';
import { KIE_MODEL_CATALOG } from './kie-unified.catalog';

const BASE = 'https://api.example.test';
const KEY = 'test-key-not-real';
// Clés calculées : sync-tool-names.mjs repère la clé name suivie d'une chaîne (aussi en fin de display_name).
const NAME = 'name';
const DISPLAY_NAME = `display_${NAME}`;
/** Sondage quasi immédiat, large marge avant le délai : les tests restent rapides et déterministes. */
const FAST = { pollIntervalMs: 50, maxWaitMs: 5_000 };

interface FetchCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Remplace fetch : chaque appel est journalisé (URL, méthode, en-têtes, corps) puis routé par le test. */
function stubFetch(route: (call: FetchCall) => Response | undefined) {
  const calls: FetchCall[] = [];
  const mock = vi.fn((input: URL | string, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const call: FetchCall = { url: new URL(String(input)), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: raw ? JSON.parse(raw) : undefined };
    calls.push(call);
    return route(call) ?? json({ code: 404, msg: 'route inattendue' }, 404);
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

const config = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'p1',
  guildId: 'g1',
  slug: 'kie',
  displayName: 'kie.ai',
  protocol: 'kie-unified',
  baseUrl: BASE,
  authType: 'bearer',
  authHeaderName: null,
  apiKey: KEY,
  customHeaders: {},
  extraConfig: {},
  models: [],
  enabled: true,
  ...overrides,
});

const options = (overrides: Partial<ChatOptions> = {}): ChatOptions => ({ userId: 'u1', guildId: 'g1', cause: 'reply', ...overrides });
const tool = (id: string): OpenAiTool => ({ type: 'function', function: { [NAME]: id, description: `outil ${id}`, parameters: { type: 'object', properties: { q: { type: 'string' } } } } });
const request = (capability: ProviderRequest['capability'], params: Record<string, unknown> = {}, modelId = 'z-image'): ProviderRequest => ({ capability, modelId, params });

/** L'appel doit lever une erreur typée du fournisseur. */
async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  return expect.unreachable('l\u0027appel aurait dû lever une erreur');
}

const CREATED = { code: 200, msg: 'success', data: { taskId: 't1' } };

/** createTask puis recordInfo, dans la forme réelle de kie.ai : `waiting` N fois (`state`, sans fichier), puis le succès avec `final`. */
function taskRoutes(final: Record<string, unknown>, processing = 1) {
  let polls = 0;
  return (call: FetchCall): Response | undefined => {
    if (call.url.pathname === '/api/v1/jobs/createTask') return json(CREATED);
    if (call.url.pathname === '/api/v1/jobs/recordInfo') {
      const current = polls;
      polls += 1;
      return json(
        current < processing
          ? { code: 200, msg: 'success', data: { taskId: 't1', state: 'waiting', successFlag: 0, failCode: null, failMsg: null, resultJson: '' } }
          : { code: 200, msg: 'success', data: { taskId: 't1', state: 'success', successFlag: 1, failCode: null, failMsg: null, ...final } },
      );
    }
    return undefined;
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('KieUnifiedAdapter · connexion et catalogue', () => {
  const MODELS = {
    models: [{ slug: 'gpt-x', [DISPLAY_NAME]: 'GPT X', context_window: 272_000 }, { slug: 'claude-y', default_reasoning_level: 'medium' }],
    data: [{ id: 'gpt-x', object: 'model' }, { id: 'claude-y', object: 'model' }, { id: 'gemini-z', object: 'model' }],
  };

  it('déclare son protocole et ses capacités natives, rien de sur mesure', () => {
    const adapter = new KieUnifiedAdapter();
    expect(adapter.protocol).toBe('kie-unified');
    expect([...adapter.capabilities]).toEqual(['chat.default', 'chat.reasoning', 'chat.ingestion', 'image.generate', 'image.edit', 'music.generate', 'tts.speak', 'video.generate']);
    expect(adapter.supports('image.edit', config())).toBe(true);
    expect(adapter.supports('web.search', config())).toBe(false);
    expect(adapter.supports('custom.x', config())).toBe(false);
  });

  it('testConnection : GET des modèles en Bearer, résume le nombre de modèles', async () => {
    const { calls } = stubFetch(() => json(MODELS));
    const check = await new KieUnifiedAdapter().testConnection(config());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe(`${BASE}/openai/v1/models`);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.body).toBeUndefined();
    expect(check).toEqual({ ok: true, summary: 'Connecté : 6 modèle(s)', modelsFound: 6 });
  });

  it('discoverModels : catalogue statique puis modèles découverts, les deux formes dédoublonnées', async () => {
    stubFetch(() => json(MODELS));
    const models = await new KieUnifiedAdapter().discoverModels(config());
    expect(KIE_MODEL_CATALOG.map((model) => model.id)).toEqual(['V6_MINI', 'V6', 'z-image']);
    expect(models.map((model) => model.id)).toEqual(['V6_MINI', 'V6', 'z-image', 'gpt-x', 'claude-y', 'gemini-z']);
    expect(models.find((model) => model.id === 'gpt-x')).toEqual({ id: 'gpt-x', [NAME]: 'GPT X', kind: 'chat', contextWindow: 272_000 });
    expect(models.find((model) => model.id === 'gemini-z')).toEqual({ id: 'gemini-z', [NAME]: 'gemini-z', kind: 'chat' });
  });

  it('discoverModels : accepte la forme OpenAI seule', async () => {
    stubFetch(() => json({ data: [{ id: 'm1', object: 'model' }, { id: 'm2' }] }));
    const models = await new KieUnifiedAdapter().discoverModels(config());
    expect(models.slice(3)).toEqual([
      { id: 'm1', [NAME]: 'm1', kind: 'chat' },
      { id: 'm2', [NAME]: 'm2', kind: 'chat' },
    ]);
  });

  it('une réponse non 2xx est une erreur typée, sans la clé même renvoyée par le fournisseur', async () => {
    stubFetch(() => json({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401));
    const error = await failure(new KieUnifiedAdapter().testConnection(config()));
    expect(error.kind).toBe('auth');
    expect(error.status).toBe(401);
    expect(error.message).toContain('Incorrect API key provided');
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });
});

describe('KieUnifiedAdapter · conversation', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'règles' },
    { role: 'user', content: 'bonjour' },
  ];
  const completion = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { [NAME]: 'records__create', arguments: '{"q":"x"}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 3 } };
  const turn = (overrides: Partial<Parameters<KieUnifiedAdapter['chat']>[1]> = {}) => ({ modelId: 'gpt-x', messages, tools: [tool('records.create')], options: options(), ...overrides });

  it('POST /v1/chat/completions en Bearer : corps OpenAI, tools encodés, réponse au format interne', async () => {
    const { calls } = stubFetch(() => json(completion));
    const result = await new KieUnifiedAdapter().chat(config(), turn());
    expect(calls[0]?.url.href).toBe(`${BASE}/v1/chat/completions`);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers).toMatchObject({ 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    expect(calls[0]?.body).toMatchObject({ model: 'gpt-x', messages, tool_choice: 'auto', tools: [{ type: 'function', function: { [NAME]: 'records__create', description: 'outil records.create' } }] });
    expect(calls[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(result).toEqual({ content: null, reasoningContent: null, toolCalls: [{ id: 'c1', [NAME]: 'records.create', arguments: '{"q":"x"}' }], usage: { promptTokens: 12, completionTokens: 3 } });
  });

  it('reasoning_effort reste omis hors de deepseek.com, même quand l\u0027appel en demande un', async () => {
    const { calls } = stubFetch(() => json(completion));
    await new KieUnifiedAdapter().chat(config(), turn({ options: options({ reasoningEffort: 'low' }) }));
    // Un nom qui contient deepseek.com sans en être un sous-domaine ne compte pas.
    await new KieUnifiedAdapter().chat(config({ baseUrl: 'https://api.notdeepseek.com' }), turn({ options: options({ reasoningEffort: 'low' }) }));
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.body).not.toHaveProperty('reasoning_effort');
  });

  it('reasoning_effort n\u0027est envoyé qu\u0027à deepseek.com', async () => {
    const { calls } = stubFetch(() => json(completion));
    await new KieUnifiedAdapter().chat(config({ baseUrl: 'https://api.deepseek.com' }), turn({ options: options({ reasoningEffort: 'low' }) }));
    expect(calls[0]?.url.href).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(calls[0]?.body).toMatchObject({ reasoning_effort: 'low' });
  });

  it('un seul delta pour une réponse en texte, aucun pour un appel d\u0027outil', async () => {
    stubFetch(() => json(completion));
    const onDelta = vi.fn();
    await new KieUnifiedAdapter().chat(config(), turn({ onDelta }));
    expect(onDelta).not.toHaveBeenCalled();
    stubFetch(() => json({ choices: [{ message: { role: 'assistant', content: 'Voici la réponse.' } }] }));
    const textDelta = vi.fn();
    const result = await new KieUnifiedAdapter().chat(config(), turn({ tools: [], onDelta: textDelta }));
    expect(result.content).toBe('Voici la réponse.');
    expect(textDelta).toHaveBeenCalledTimes(1);
    expect(textDelta).toHaveBeenCalledWith('Voici la réponse.');
  });

  it('un refus HTTP est une erreur typée, sans la clé', async () => {
    stubFetch(() => json({ error: { message: `bad key ${KEY}` } }, 401));
    const error = await failure(new KieUnifiedAdapter().chat(config(), turn()));
    expect(error.kind).toBe('auth');
    expect(error.message).toContain('bad key');
    expect(error.message).not.toContain(KEY);
  });

  it('une clé recopiée par le fournisseur dans une réponse réussie n\u0027est jamais rendue ni diffusée', async () => {
    stubFetch(() => json({ choices: [{ message: { role: 'assistant', content: `voici ${KEY}` } }] }));
    const onDelta = vi.fn();
    const error = await failure(new KieUnifiedAdapter().chat(config(), turn({ tools: [], onDelta })));
    expect(error.kind).toBe('http');
    expect(onDelta).not.toHaveBeenCalled();
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });

  it('un catalogue de modèles qui recopie la clé est refusé', async () => {
    stubFetch(() => json({ models: [{ slug: 'm1', [DISPLAY_NAME]: `modèle ${KEY}` }] }));
    const error = await failure(new KieUnifiedAdapter().discoverModels(config()));
    expect(error.kind).toBe('http');
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });
});

describe('KieUnifiedAdapter · tâches', () => {
  it('image.generate : createTask puis recordInfo en Bearer, resultJson décodé en urls', async () => {
    const urls = ['https://cdn.example.test/a.png', 'https://cdn.example.test/b.png'];
    const { calls } = stubFetch(taskRoutes({ resultJson: JSON.stringify({ resultUrls: urls }) }));
    const result = await new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', aspectRatio: '16:9', ...FAST }));
    const [create, ...polls] = calls;
    expect(create?.url.href).toBe(`${BASE}/api/v1/jobs/createTask`);
    expect(create?.method).toBe('POST');
    expect(create?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(create?.body).toEqual({ model: 'z-image', input: { prompt: 'un chat', aspect_ratio: '16:9' } });
    expect(polls).toHaveLength(2);
    for (const poll of polls) {
      expect(poll.url.href).toBe(`${BASE}/api/v1/jobs/recordInfo?taskId=t1`);
      expect(poll.method).toBe('GET');
      expect(poll.headers.Authorization).toBe(`Bearer ${KEY}`);
      expect(poll.body).toBeUndefined();
    }
    expect(result).toEqual({ ok: true, summary: 'Génération d\u0027image réussie par z-image (2 fichiers, taskId t1).', data: { urls } });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it.each([
    ['image.edit', 'img-1', { prompt: 'un chapeau', image: 'https://img.example.test/src.png', aspect_ratio: '1:1' }, { prompt: 'un chapeau', image: 'https://img.example.test/src.png', aspect_ratio: '1:1' }],
    ['video.generate', 'vid-1', { prompt: 'un vol', duration: 5, image: 'https://img.example.test/poster.png' }, { prompt: 'un vol', duration: 5, image: 'https://img.example.test/poster.png' }],
    ['tts.speak', 'tts-1', { input: 'Bonjour', voice: 'alice' }, { text: 'Bonjour', voice_id: 'alice' }],
  ] as const)('%s : corps de la tâche et résultat', async (capability, modelId, params, input) => {
    const { calls } = stubFetch(taskRoutes({ resultJson: '{"resultUrls":["https://cdn.example.test/out.bin"]}' }));
    const result = await new KieUnifiedAdapter().execute(config(), { capability, modelId, params: { ...params, ...FAST } });
    expect(calls[0]?.body).toEqual({ model: modelId, input });
    expect(result.data).toEqual({ urls: ['https://cdn.example.test/out.bin'] });
  });

  it('music.generate : le modèle Suno voyage dans input, la piste vient de response.data[]', async () => {
    const track = { id: 's1', title: 'Nuit blanche', duration: 95.4, audio_url: 'https://cdn.example.test/song.mp3', image_url: 'https://cdn.example.test/cover.png' };
    const { calls } = stubFetch(taskRoutes({ response: { type: 'music', data: [track] } }));
    const params = { title: 'Nuit', style: 'trap', prompt: 'un couplet', instrumental: false, duration: 60, ...FAST };
    const result = await new KieUnifiedAdapter().execute(config(), request('music.generate', params, 'V6_MINI'));
    expect(calls[0]?.body).toEqual({
      model: 'ai-music-api/generate',
      input: { custom_mode: true, model: 'V6_MINI', title: 'Nuit', style: 'trap', prompt: 'un couplet', instrumental: false, duration: 60 },
    });
    // La pochette (image_url) n'est pas un fichier produit.
    expect(result).toEqual({ ok: true, summary: 'Musique réussie par V6_MINI (1 fichier, taskId t1).', data: { audioUrl: 'https://cdn.example.test/song.mp3', title: 'Nuit blanche', duration: 95 } });
  });

  it('music.generate instrumental : aucune paroles envoyée', async () => {
    const { calls } = stubFetch(taskRoutes({ response: { data: [{ audio_url: 'https://cdn.example.test/song.mp3' }] } }));
    await new KieUnifiedAdapter().execute(config(), request('music.generate', { title: 'Nuit', style: 'trap', prompt: 'un couplet', instrumental: true, ...FAST }, 'V6'));
    expect(calls[0]?.body).toEqual({ model: 'ai-music-api/generate', input: { custom_mode: true, model: 'V6', title: 'Nuit', style: 'trap', instrumental: true } });
  });

  it.each(['web.search', 'custom.translate', 'chat.default'])('ne crée aucune tâche pour « %s »', async (capability) => {
    const { mock } = stubFetch(taskRoutes({}));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request(capability as ProviderRequest['capability'])));
    expect(error.kind).toBe('unsupported');
    expect(mock).not.toHaveBeenCalled();
  });

  it('une demande déjà annulée ne crée aucune tâche', async () => {
    const { mock } = stubFetch(taskRoutes({}));
    const controller = new AbortController();
    controller.abort();
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', FAST), controller.signal));
    expect(error.message).toBe('Demande annulée.');
    expect(isFallbackEligible(error)).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });
});
