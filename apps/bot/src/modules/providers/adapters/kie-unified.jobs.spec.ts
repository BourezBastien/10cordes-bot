import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFallbackEligible, ProviderError, type ProviderConfig, type ProviderRequest } from '../provider.types';
import { KieUnifiedAdapter } from './kie-unified.adapter';
import { collectResultUrls, kieTaskData } from './kie-unified.results';
import { kiePollTiming } from './kie-unified.tasks';

const BASE = 'https://api.example.test';
const KEY = 'test-key-not-real';
const FAST = { pollIntervalMs: 50, maxWaitMs: 5_000 };
const CREATE = '/api/v1/jobs/createTask';
const RECORD = '/api/v1/jobs/recordInfo';

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
    return route(call) ?? new Response('route inattendue', { status: 500 });
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

const request = (capability: ProviderRequest['capability'], params: Record<string, unknown> = FAST): ProviderRequest => ({ capability, modelId: 'z-image', params });
/** Une réponse NEUVE à chaque appel : le corps d'une Response ne se lit qu'une fois. */
const created = () => json({ code: 200, msg: 'success', data: { taskId: 't1' } });
const record = (data: Record<string, unknown>) => json({ code: 200, msg: 'success', data: { taskId: 't1', ...data } });
const isCreate = (call: FetchCall) => call.url.pathname === CREATE;

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

/** Tâche créée, puis `answer` à chaque sondage. */
function polling(answer: () => Response) {
  return stubFetch((call) => (isCreate(call) ? created() : answer()));
}

afterEach(() => vi.unstubAllGlobals());

describe('kie-unified · sondage d\u0027une tâche', () => {
  it('délai dépassé : rend pending sans lever, la tâche continue côté fournisseur', async () => {
    let polls = 0;
    // Le commentaire parle de statut : l'état alterne entre deux valeurs « en cours », toutes deux sondées sans fin.
    const { calls } = polling(() => {
      polls += 1;
      return record({ state: polls % 2 === 0 ? 'processing' : 'waiting', successFlag: 0, failCode: null, failMsg: null });
    });
    const result = await new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', maxWaitMs: 400, pollIntervalMs: 50 }));
    expect(result).toMatchObject({ ok: true, data: { pending: true, taskId: 't1' } });
    expect(Object.keys(result)).toEqual(['ok', 'summary', 'data']);
    expect(result.summary).toMatch(/^Tâche encore en cours après \d+ s \(taskId t1\)\.$/u);
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(calls).toHaveLength(1 + polls);
    for (const call of calls.slice(1)) expect(call.url.href).toBe(`${BASE}${RECORD}?taskId=t1`);
  });

  it('une intervalle plus longue que le délai ne retarde pas le rendu : dernière sonde au délai', async () => {
    let polls = 0;
    polling(() => {
      polls += 1;
      return record({ state: 'processing' });
    });
    // Sans écrêtage de la dernière attente, la sonde tomberait à 60 s et le test dépasserait son propre délai.
    const startedAt = Date.now();
    const result = await new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', maxWaitMs: 200, pollIntervalMs: 60_000 }));
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(polls).toBe(1);
    expect(result.data).toEqual({ pending: true, taskId: 't1' });
  });

  it('tâche déclarée en échec : ProviderError avec la raison, non éligible à une bascule', async () => {
    polling(() => record({ state: 'failed', successFlag: 0, failCode: 'content_policy', failMsg: 'Prompt rejected by safety policy' }));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST })));
    expect(error.message).toBe('La tâche kie.ai t1 a échoué : Prompt rejected by safety policy');
    expect(isFallbackEligible(error)).toBe(false);
  });

  it('un état d\u0027échec écrit autrement, ou un ancien `status`, sont entendus de la même façon', async () => {
    for (const data of [
      { state: 'FAILED', errorMsg: 'Prompt rejected' },
      { status: 'failed', errorMsg: 'Prompt rejected' },
      { successFlag: 0, failCode: 1201, failMsg: 'Prompt rejected' },
      { state: 'waiting', failMsg: 'Prompt rejected' },
    ]) {
      polling(() => record(data));
      const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST })));
      expect(error.message).toBe('La tâche kie.ai t1 a échoué : Prompt rejected');
    }
  });

  it('refus logique à la création (HTTP 200, code 402) : erreur quota à la clé masquée, jamais sondée', async () => {
    const { calls } = stubFetch(() => json({ code: 402, msg: `Insufficient credits balance (key ${KEY})`, data: null }));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate')));
    expect(error.kind).toBe('quota');
    expect(error.status).toBeUndefined();
    expect(error.message).toBe('kie.ai a refusé la demande (code 402) : Insufficient credits balance (key [clé masquée])');
    expect(calls).toHaveLength(1);
  });

  it.each([
    [401, 'auth'],
    [429, 'rate-limit'],
    [422, 'invalid'],
    [500, 'unavailable'],
  ])('refus logique code %i : kind %s', async (code, kind) => {
    stubFetch(() => json({ code, msg: 'refusé' }));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate')));
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(`kie.ai a refusé la demande (code ${code}) : refusé`);
  });

  it('création sans taskId : erreur qui reprend la raison du fournisseur, plutôt qu\u0027un sondage sans identifiant', async () => {
    const { calls } = stubFetch(() => json({ msg: 'réponse inattendue' }));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate')));
    expect(error.kind).toBe('http');
    expect(error.message).toBe('kie.ai a refusé la demande (réponse sans code ni taskId) : réponse inattendue');
    expect(calls).toHaveLength(1);
  });

  it('refus logique pendant le sondage (code 429) : erreur rate-limit qui nomme la tâche', async () => {
    polling(() => json({ code: 429, msg: 'Too many requests' }));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST })));
    expect(error.kind).toBe('rate-limit');
    expect(error.message).toBe('kie.ai a refusé la tâche t1 (code 429) : Too many requests');
  });

  it('refus HTTP pendant le sondage (500) : indisponible, sans la clé', async () => {
    polling(() => json({ error: { message: `upstream down for ${KEY}` } }, 500));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST })));
    expect(error.kind).toBe('unavailable');
    expect(error.status).toBe(500);
    expect(error.message).toContain('upstream down');
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });

  it('annulation pendant le sondage : plus aucune requête, jamais de bascule', async () => {
    const controller = new AbortController();
    const { calls } = stubFetch((call) => {
      if (isCreate(call)) return created();
      controller.abort();
      return record({ state: 'processing' });
    });
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST }), controller.signal));
    expect(error.message).toBe('Demande annulée (tâche t1).');
    expect(isFallbackEligible(error)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('annulation PENDANT la création : annulation, pas un timeout qui basculerait sur le fournisseur de repli', async () => {
    const controller = new AbortController();
    const { calls } = stubFetch(() => {
      // Ce que fait un vrai fetch interrompu : il rejette avec une AbortError.
      controller.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST }), controller.signal));
    expect(error.kind).toBe('http');
    expect(error.message).toBe('Demande annulée.');
    expect(isFallbackEligible(error)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('annulation PENDANT une sonde : même erreur, la tâche n\u0027est plus sondée', async () => {
    const controller = new AbortController();
    const { calls } = stubFetch((call) => {
      if (isCreate(call)) return created();
      controller.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST }), controller.signal));
    expect(error.message).toBe('Demande annulée (tâche t1).');
    expect(isFallbackEligible(error)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('succès sans fichier lisible : une erreur plutôt qu\u0027un résultat vide', async () => {
    polling(() => record({ state: 'success', successFlag: 1, resultJson: '{"progress":100}' }));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST })));
    expect(error.kind).toBe('http');
    expect(error.message).toBe('La tâche kie.ai t1 a réussi mais son résultat est illisible (aucun fichier produit).');
  });

  it('une clé recopiée par le fournisseur dans une tâche réussie ne ressort jamais', async () => {
    polling(() => record({ state: 'success', successFlag: 1, resultJson: JSON.stringify({ resultUrls: [`https://cdn.example.test/a.png?token=${KEY}`] }) }));
    const error = await failure(new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST })));
    expect(error.kind).toBe('http');
    expect(isFallbackEligible(error)).toBe(false);
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });

  it('forme réelle d\u0027une tâche z-image (observée le 24/11) : l\u0027état est dans `state`, jamais dans `status`', async () => {
    const url = 'https://cdn.example.test/render.png';
    let polls = 0;
    const { calls } = polling(() => {
      polls += 1;
      return polls === 1
        ? record({ model: 'z-image', state: 'waiting', successFlag: 0, failCode: null, failMsg: null, resultJson: '', creditsConsumed: 0.8 })
        : record({
            model: 'z-image',
            state: 'success',
            successFlag: 1,
            failCode: null,
            failMsg: null,
            costTime: 7,
            creditsConsumed: 0.8,
            resultJson: JSON.stringify({ resultUrls: [url] }),
            response: { resultUrls: [url] },
          });
    });
    const result = await new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST }));
    // Deux sondes, pas dix-huit : une image prête est livrée à la sonde qui la voit.
    expect(polls).toBe(2);
    expect(calls).toHaveLength(3);
    expect(result).toMatchObject({ ok: true, data: { urls: [url] } });
  });

  it('un état inconnu qui porte déjà des fichiers produits est livré ; sans fichier, on attend', async () => {
    const url = 'https://cdn.example.test/render.png';
    let polls = 0;
    polling(() => {
      polls += 1;
      return polls === 1
        ? record({ state: 'quelque-chose-de-nouveau', successFlag: 0, resultJson: '' })
        : record({ state: 'quelque-chose-de-nouveau', response: { resultUrls: [url] } });
    });
    const result = await new KieUnifiedAdapter().execute(config(), request('image.generate', { prompt: 'un chat', ...FAST }));
    expect(polls).toBe(2);
    expect(result.data).toEqual({ urls: [url] });
  });
});

describe('kie-unified · attente et lecture des résultats', () => {
  it('attente par défaut : 90 s (image, voix), 150 s (musique), 300 s (vidéo), une sonde toutes les 5 s', () => {
    expect(kiePollTiming('image.edit', {})).toEqual({ maxWaitMs: 90_000, pollIntervalMs: 5_000 });
    expect(kiePollTiming('tts.speak', {})).toEqual({ maxWaitMs: 90_000, pollIntervalMs: 5_000 });
    expect(kiePollTiming('music.generate', {})).toEqual({ maxWaitMs: 150_000, pollIntervalMs: 5_000 });
    expect(kiePollTiming('video.generate', {})).toEqual({ maxWaitMs: 300_000, pollIntervalMs: 5_000 });
    expect(kiePollTiming('video.generate', { maxWaitMs: 1_000, pollIntervalMs: 250 })).toEqual({ maxWaitMs: 1_000, pollIntervalMs: 250 });
  });

  it('un intervalle trop court ou invalide retombe sur un plancher, jamais une boucle serrée', () => {
    expect(kiePollTiming('image.generate', { pollIntervalMs: 0 })).toEqual({ maxWaitMs: 90_000, pollIntervalMs: 50 });
    expect(kiePollTiming('image.generate', { pollIntervalMs: 'x', maxWaitMs: -5 })).toEqual({ maxWaitMs: 90_000, pollIntervalMs: 5_000 });
  });

  it('collectResultUrls : chaîne JSON, URL nue, objet déjà parsé, pistes Suno sans la pochette', () => {
    expect(collectResultUrls({ resultJson: '{"resultUrls":["https://c.test/a.png"]}' })).toEqual(['https://c.test/a.png']);
    expect(collectResultUrls({ resultJson: 'https://c.test/b.png' })).toEqual(['https://c.test/b.png']);
    expect(collectResultUrls({ resultJson: { videos: [{ url: 'https://c.test/v.mp4' }] } })).toEqual(['https://c.test/v.mp4']);
    expect(collectResultUrls({ resultJson: 'pas du json', response: { data: [{ audio_url: 'https://c.test/a.mp3', image_url: 'https://c.test/cover.png' }] } })).toEqual(['https://c.test/a.mp3']);
    expect(collectResultUrls({ resultJson: '{"resultUrls":[]}' })).toEqual([]);
  });

  it('kieTaskData : la musique garde le titre et la durée demandés à défaut de ceux de la piste', () => {
    expect(kieTaskData('music.generate', { response: { data: [{ audio_url: 'https://c.test/a.mp3' }] } }, { title: 'Nuit', duration: 42 }, 't1')).toEqual({ audioUrl: 'https://c.test/a.mp3', title: 'Nuit', duration: 42 });
    expect(kieTaskData('image.generate', { resultJson: '{"resultUrls":["https://c.test/a.png"]}' }, {}, 't1')).toEqual({ urls: ['https://c.test/a.png'] });
  });
});
