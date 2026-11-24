import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, type ProviderConfig, type ProviderRequest } from '../provider.types';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

// Clés calculées : sync-tool-names.mjs repère une clé `name` (aussi en fin de `displayName`) suivie d'une chaîne.
const DISPLAY_NAME = 'displayName';
const KEY = 'test-key-not-real';
const BASE = 'https://api.example.test/v1';

/** Images (`/images/generations`, `/images/edits`) et voix (`/audio/speech`) : corps envoyés, résultats normalisés. */

const fetchMock = vi.fn<typeof fetch>();
const adapter = new OpenAiCompatibleAdapter();

function config(): ProviderConfig {
  return {
    id: 'provider-1',
    guildId: 'guild-1',
    slug: 'example',
    [DISPLAY_NAME]: 'Example',
    protocol: 'openai-chat',
    baseUrl: BASE,
    authType: 'bearer',
    authHeaderName: null,
    apiKey: KEY,
    customHeaders: {},
    extraConfig: {},
    models: [],
    enabled: true,
  };
}

const reply = (body: unknown, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

/** Chaque appel reçoit une Response neuve : un corps ne se lit qu'une fois. */
const serve = (body: unknown, status = 200, headers?: Record<string, string>): void => {
  fetchMock.mockImplementation(async () => reply(body, status, headers));
};
const serveAudio = (bytes: number[], contentType?: string): void => {
  fetchMock.mockImplementation(async () => new Response(new Uint8Array(bytes), { status: 200, headers: contentType ? { 'content-type': contentType } : {} }));
};

const run = (capability: ProviderRequest['capability'], params: Record<string, unknown>, modelId = 'dall-e-3'): ReturnType<OpenAiCompatibleAdapter['execute']> =>
  adapter.execute(config(), { capability, modelId, params });

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('aucun appel fetch');
  return { url: String(call[0]), init: call[1] ?? {} };
}
const bodyOf = (init: RequestInit): Record<string, unknown> => JSON.parse(String(init.body)) as Record<string, unknown>;
const headersOf = (init: RequestInit): Record<string, string> => init.headers as Record<string, string>;

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect(JSON.stringify({ error, message: (error as Error).message, stack: (error as Error).stack })).not.toContain(KEY);
    return error as ProviderError;
  }
  throw new Error('appel réussi alors qu\u0027un échec était attendu');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const imageResponse = (images: unknown[]): unknown => ({ created: 1, data: images });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('execute · image.generate', () => {
  it('POST /images/generations : prompt, options transmises, base64 par défaut', async () => {
    serve(imageResponse([{ b64_json: 'AAA', revised_prompt: 'un chat' }]));
    const result = await run('image.generate', { prompt: 'un chat', n: 2, size: '1024x1024', quality: 'hd' });
    expect(lastCall().url).toBe(`${BASE}/images/generations`);
    expect(lastCall().init.method).toBe('POST');
    expect(bodyOf(lastCall().init)).toEqual({
      model: 'dall-e-3',
      prompt: 'un chat',
      n: 2,
      size: '1024x1024',
      quality: 'hd',
      response_format: 'b64_json',
    });
    expect(headersOf(lastCall().init)).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });
    expect(result).toEqual({ ok: true, summary: '1 image(s) générée(s).', data: { images: [{ b64_json: 'AAA' }], revisedPrompt: 'un chat' } });
  });

  it('responseFormat url est transmis ; un modèle GPT Image ne le reçoit pas (il refuse le champ)', async () => {
    serve(imageResponse([{ url: 'https://cdn.example.test/a.png' }]));
    const result = await run('image.generate', { prompt: 'un chat', responseFormat: 'url' });
    expect(bodyOf(lastCall().init)).toMatchObject({ response_format: 'url' });
    expect(result.data).toEqual({ images: [{ url: 'https://cdn.example.test/a.png' }] });
    await run('image.generate', { prompt: 'un chat', responseFormat: 'url' }, 'gpt-image-1');
    expect(bodyOf(lastCall().init)).not.toHaveProperty('response_format');
  });

  it('prompt manquant, responseFormat inconnu, n invalide : erreur invalid, sans appel', async () => {
    for (const params of [{}, { prompt: 'x', responseFormat: 'jpeg' }, { prompt: 'x', n: 1.5 }]) {
      const error = await failure(run('image.generate', params));
      expect(error.kind).toBe('invalid');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('échec HTTP : erreur typée sans la clé, corps illisible : unavailable', async () => {
    serve({ error: { message: `clé refusée : ${KEY}` } }, 429);
    expect((await failure(run('image.generate', { prompt: 'x' }))).kind).toBe('rate-limit');
    serve({ created: 1 });
    expect((await failure(run('image.generate', { prompt: 'x' }))).kind).toBe('unavailable');
  });
});

describe('execute · image.edit', () => {
  it('multipart : image décodée depuis du base64 nu (format reconnu à la signature), prompt et options', async () => {
    serve(imageResponse([{ b64_json: 'BBB' }]));
    const result = await run('image.edit', { image: PNG.toString('base64'), prompt: 'ajoute un chapeau', n: 1, size: '1024x1024' }, 'gpt-image-1');
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/images/edits`);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('ajoute un chapeau');
    expect(form.get('n')).toBe('1');
    expect(form.get('size')).toBe('1024x1024');
    const image = form.get('image') as File;
    expect([image.type, image.name]).toEqual(['image/png', 'image.png']);
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);
    // Pas de Content-Type posé ici : la boundary du multipart vient du runtime.
    expect(headersOf(init)).toEqual({ Authorization: `Bearer ${KEY}` });
    expect(result).toEqual({ ok: true, summary: '1 image(s) modifiée(s).', data: { images: [{ b64_json: 'BBB' }] } });
  });

  it('data URL et masque : le format déclaré par la data URL l\u0027emporte', async () => {
    serve(imageResponse([]));
    const webp = `data:image/webp;base64,${Buffer.from('RIFF....WEBPVP8 ').toString('base64')}`;
    await run('image.edit', { image: webp, mask: PNG.toString('base64'), prompt: 'x' });
    const form = lastCall().init.body as FormData;
    expect((form.get('image') as File).type).toBe('image/webp');
    expect((form.get('mask') as File).type).toBe('image/png');
    expect(lastCall().init.body).toBeInstanceOf(FormData);
  });

  it('image absente ou illisible : erreur invalid, sans appel', async () => {
    for (const params of [{ prompt: 'x' }, { prompt: 'x', image: 'data:image/png,%89PNG' }, { prompt: 'x', image: '###' }]) {
      const error = await failure(run('image.edit', params));
      expect(error.kind).toBe('invalid');
      expect(error.message).toMatch(/image/u);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('execute · tts.speak', () => {
  it('POST /audio/speech ; la réponse binaire devient audioBase64', async () => {
    const audio = [1, 2, 3, 4];
    serveAudio(audio, 'audio/mpeg');
    const result = await run('tts.speak', { input: 'Bonjour', voice: 'alloy', format: 'mp3', speed: 1.2 }, 'tts-1');
    expect(lastCall().url).toBe(`${BASE}/audio/speech`);
    expect(lastCall().init.method).toBe('POST');
    expect(bodyOf(lastCall().init)).toEqual({ model: 'tts-1', input: 'Bonjour', voice: 'alloy', response_format: 'mp3', speed: 1.2 });
    expect(result).toEqual({ ok: true, summary: 'Voix générée (mp3, durée inconnue).', data: { audioBase64: Buffer.from(audio).toString('base64'), format: 'mp3' } });
  });

  it('sans format demandé : response_format omis (défaut mp3 du fournisseur), annoncé comme mp3', async () => {
    serveAudio([9]);
    const result = await run('tts.speak', { input: 'Bonjour', voice: 'nova' }, 'gpt-4o-mini-tts');
    expect(bodyOf(lastCall().init)).toEqual({ model: 'gpt-4o-mini-tts', input: 'Bonjour', voice: 'nova' });
    expect(result.data.format).toBe('mp3');
  });

  it('un corps JSON ou vide sur un 2xx est une erreur, jamais un audio', async () => {
    serve({ error: { message: `voice inconnue, clé ${KEY}` } });
    const json = await failure(run('tts.speak', { input: 'x', voice: 'y' }));
    expect(json.kind).toBe('http');
    expect(json.message).toContain('voice inconnue');
    serveAudio([]);
    expect((await failure(run('tts.speak', { input: 'x', voice: 'y' }))).kind).toBe('unavailable');
  });

  it('input ou voice manquant, format bancal : erreur invalid, sans appel', async () => {
    for (const params of [{ voice: 'alloy' }, { input: 'x' }, { input: 'x', voice: 'alloy', format: 'mp3;x' }]) {
      const error = await failure(run('tts.speak', params));
      expect(error.kind).toBe('invalid');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
