import { describe, expect, it, vi, type Mock } from 'vitest';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { safeFetch } from '../../shared/utils/safe-fetch';
import type { GuildIntegrationService } from '../integrations/guild-integration.service';
import type { CapabilityRouterService } from '../providers/capability-router.service';
import type { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { ImagelabService } from './imagelab.service';
import { IMAGE_RATIOS, PENDING_MESSAGE } from './routed-image';

// Réponse de PixelLab (création d'une image pixflux) ; vaut aussi pour tout téléchargement d'image rendue par URL.
vi.mock('../../shared/utils/safe-fetch', () => ({
  safeFetch: vi.fn(async () => new Response(JSON.stringify({ image: { type: 'base64', base64: 'cG5nLWJ5dGVz' }, usage: { usd: 0.02 } }), { status: 200, headers: { 'content-type': 'application/json' } })),
}));
vi.mock('./imagelab-card', () => ({ renderCard: vi.fn(async () => ({ png: Buffer.from('carte'), width: 600, height: 240 })) }));

/**
 * Images du bot, trois moteurs distincts : PixelLab (intégration pixel art),
 * le modèle d'IA routé sur le serveur (generateImage), la carte composée en
 * local. Ce que fixent ces tests : sans clé ni route, refus honnête et rien
 * n'est consommé ; une image livrée est UNE vraie pièce jointe, jamais une
 * URL (Discord rend chaque lien en lecteur).
 */

// Clé calculée : sync-tool-names.mjs repère une clé `name` suivie d'une chaîne, même pour un nom de fichier.
const FILE = 'name';
// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const ACTOR = '1550000000000000002';

function harness(options: { pixellab?: boolean; routed?: boolean } = {}) {
  const registered: BotTool[] = [];
  const registry = { register: vi.fn((tool: BotTool) => { registered.push(tool); }) };
  const integrations = {
    resolve: vi.fn(async () => ({ slug: 'pixellab', enabled: true, origin: options.pixellab ? 'instance' : 'none', config: options.pixellab ? { apiKey: `${KEY}-pixel` } : {} })),
    active: vi.fn(async () => options.pixellab ?? false),
  };
  const router = {
    resolve: vi.fn(async () => (options.routed ? { provider: { slug: 'kie-ai' }, modelId: 'z-image' } : null)),
    runCapability: vi.fn<CapabilityRouterService['runCapability']>(async () => ({ ok: true, summary: 'ok', data: { images: [{ b64_json: Buffer.from('png').toString('base64') }] } })),
  };
  const service = new ImagelabService(registry as unknown as ToolRegistryService, integrations as unknown as GuildIntegrationService, router as unknown as CapabilityRouterService);
  return { service, registered, router };
}

type TestContext = ToolRunContext & { sendFile: Mock<NonNullable<ToolRunContext['sendFile']>> };

function context(overrides: Partial<ToolRunContext> = {}): TestContext {
  const sendFile = vi.fn<NonNullable<ToolRunContext['sendFile']>>(async () => undefined);
  return { guildId: GUILD, channelId: '1550000000000000003', userId: ACTOR, locale: 'fr', permissions: [], reply: vi.fn(async () => undefined), sendFile, ...overrides } as TestContext;
}

function tool(registered: BotTool[], wanted: string): BotTool {
  const found = registered.find((entry) => entry.name === wanted);
  if (!found) throw new Error(`outil ${wanted} non enregistré`);
  return found;
}

async function boot(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  await h.service.onBoot();
  return { ...h, generate: tool(h.registered, 'generateImage'), icon: tool(h.registered, 'image.icon'), emoji: tool(h.registered, 'image.emoji'), compose: tool(h.registered, 'image.compose') };
}

describe('ImagelabService · outils enregistrés', () => {
  it('quatre outils, et l\u0027intégration PixelLab de l\u0027instance se lit à l\u0027amorçage', async () => {
    const off = await boot({});
    expect(off.registered.map((entry) => entry.name).sort()).toEqual(['generateImage', 'image.compose', 'image.emoji', 'image.icon']);
    expect(off.service.configured).toBe(false);
    expect((await boot({ pixellab: true })).service.configured).toBe(true);
  });

  it('seuls les outils PixelLab, qui créent des expressions du serveur, exigent une permission', async () => {
    const { generate, icon, emoji, compose } = await boot({ pixellab: true, routed: true });
    expect([icon, emoji].every((entry) => entry.permissions?.includes('ManageGuildExpressions') && entry.destructive === false)).toBe(true);
    expect(generate.permissions).toEqual([]);
    expect(compose.permissions).toEqual([]);
    // generateImage se trouve depuis une demande d'image, sans chercher les outils.
    expect(generate.keywords).toEqual(expect.arrayContaining(['image', 'illustration', 'photo', 'imagine']));
    expect(generate.systemPrompt).toContain('image.icon/image.emoji (PixelLab)');
  });
});

describe('generateImage · le modèle d\u0027IA routé sur le serveur', () => {
  const PROMPT = 'un phare orange à la tombée de la nuit, vue large';

  it('sans route image.generate : refus honnête, rien n\u0027est consommé ni envoyé', async () => {
    const { generate, router } = await boot({ routed: false });
    const ctx = context();
    expect(await generate.handler({ prompt: PROMPT }, ctx)).toMatchObject({ ok: false, summary: expect.stringContaining('Aucun modèle d\u0027image routé') });
    expect(router.runCapability).not.toHaveBeenCalled();
    expect(ctx.sendFile).not.toHaveBeenCalled();
  });

  it('hors serveur (surface sans guilde) : refus', async () => {
    const { generate, router } = await boot({ routed: true });
    expect(await generate.handler({ prompt: PROMPT }, context({ guildId: null }))).toEqual({ ok: false, summary: 'Contexte de serveur requis.' });
    expect(router.runCapability).not.toHaveBeenCalled();
  });

  it.each([
    ['1:1', '1024x1024'],
    ['16:9', '1536x1024'],
    ['9:16', '1024x1536'],
    ['4:3', '1536x1024'],
    ['3:4', '1024x1536'],
  ])('ratio %s : le modèle routé reçoit le prompt, le ratio et la taille équivalente, et UNE pièce jointe part', async (ratio, size) => {
    const { generate, router } = await boot({ routed: true });
    const ctx = context();
    const result = await generate.handler({ prompt: PROMPT, label: 'Phare', aspect_ratio: ratio }, ctx);
    expect(router.runCapability).toHaveBeenCalledTimes(1);
    expect(router.runCapability).toHaveBeenCalledWith(GUILD, 'image.generate', { params: { prompt: PROMPT, aspect_ratio: ratio, size } }, ACTOR);
    expect(ctx.sendFile).toHaveBeenCalledTimes(1);
    expect(ctx.sendFile.mock.calls[0]?.[0]).toEqual({ [FILE]: 'Phare.png', attachment: expect.any(Buffer) });
    expect(ctx.sendFile.mock.calls[0]?.[0].attachment.toString()).toBe('png');
    expect(result).toEqual({ ok: true, summary: `Image générée et envoyée dans le salon (ratio ${ratio}).`, data: { aspectRatio: ratio } });
  });

  it('sans précision : fichier « image », ratio carré', async () => {
    const { generate, router } = await boot({ routed: true });
    const ctx = context();
    await generate.handler({ prompt: PROMPT }, ctx);
    expect(router.runCapability.mock.calls[0]?.[2]).toEqual({ params: { prompt: PROMPT, aspect_ratio: '1:1', size: '1024x1024' } });
    expect(ctx.sendFile.mock.calls[0]?.[0].name).toBe('image.png');
  });

  it('une tâche kie.ai rend ses fichiers par URL : téléchargés par la garde, livrés une fois, jamais montrés', async () => {
    const { generate, router } = await boot({ routed: true });
    router.runCapability.mockResolvedValueOnce({ ok: true, summary: 'Génération d\u0027image réussie par z-image (1 fichier, taskId abc).', data: { urls: ['https://cdn.example.test/task.png'] } });
    const ctx = context();
    const result = await generate.handler({ prompt: PROMPT, label: 'Carte de GTA 7', aspect_ratio: '16:9' }, ctx);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(safeFetch).toHaveBeenCalledWith('https://cdn.example.test/task.png', { timeoutMs: 60_000 });
    expect(ctx.sendFile.mock.calls[0]?.[0]).toMatchObject({ name: 'Carte-de-GTA-7.png' });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toMatch(/https?:|taskId/u);
  });

  it('une tâche encore en cours au-delà du délai : rien à livrer, et le membre sait quoi faire', async () => {
    const { generate, router } = await boot({ routed: true });
    router.runCapability.mockResolvedValueOnce({ ok: true, summary: 'Tâche encore en cours après 90 s.', data: { pending: true, taskId: 'abc' } });
    const ctx = context();
    expect(await generate.handler({ prompt: PROMPT }, ctx)).toEqual({ ok: false, summary: PENDING_MESSAGE });
    expect(ctx.sendFile).not.toHaveBeenCalled();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('échec du fournisseur : refus avec la raison, rien n\u0027est livré', async () => {
    const { generate, router } = await boot({ routed: true });
    const ctx = context();
    router.runCapability.mockResolvedValueOnce({ ok: false, summary: 'quota insuffisant', data: {} });
    expect(await generate.handler({ prompt: PROMPT }, ctx)).toEqual({ ok: false, summary: 'Génération d\u0027image impossible : quota insuffisant' });
    router.runCapability.mockRejectedValueOnce(new Error('HTTP 503'));
    expect(await generate.handler({ prompt: PROMPT }, ctx)).toEqual({ ok: false, summary: 'Génération d\u0027image impossible : HTTP 503' });
    expect(ctx.sendFile).not.toHaveBeenCalled();
  });

  it('une tâche réussie sans fichier : refus, jamais une pièce jointe vide', async () => {
    const { generate, router } = await boot({ routed: true });
    router.runCapability.mockResolvedValueOnce({ ok: true, summary: 'ok', data: {} });
    const ctx = context();
    expect(await generate.handler({ prompt: PROMPT }, ctx)).toMatchObject({ ok: false, summary: 'Génération d\u0027image impossible : Le fournisseur n\u0027a pas renvoyé d\u0027image.' });
    expect(ctx.sendFile).not.toHaveBeenCalled();
  });

  it('surface sans fichiers : le résultat dit que l\u0027image n\u0027est pas postée', async () => {
    const { generate } = await boot({ routed: true });
    expect(await generate.handler({ prompt: PROMPT }, context({ sendFile: undefined }))).toMatchObject({ ok: false, summary: expect.stringContaining('l\u0027envoi dans le salon a échoué') });
  });

  it('le schéma refuse un prompt trop court et un ratio inconnu', async () => {
    const { generate } = await boot({ routed: true });
    const schema = generate.paramsSchema.safeParse({ prompt: 'court' });
    expect(schema.success).toBe(false);
    expect(generate.paramsSchema.safeParse({ prompt: PROMPT, aspect_ratio: '21:9' }).success).toBe(false);
    expect(IMAGE_RATIOS['16:9'].size).toBe('1536x1024');
  });
});

describe('image.icon et image.emoji · l\u0027intégration PixelLab', () => {
  it('sans PixelLab : refus honnête, aucune requête', async () => {
    const { icon, emoji } = await boot({ pixellab: false });
    expect(await icon.handler({ description: 'une bouée orange sur fond sombre', size: 128, transparent: false }, context())).toMatchObject({ ok: false, summary: expect.stringContaining('PixelLab n\u0027est pas configuré') });
    expect(await emoji.handler({ description: 'une bouée orange' }, context())).toMatchObject({ ok: false });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('avec PixelLab : la clé de l\u0027intégration en Bearer, et UNE pièce jointe', async () => {
    const { icon } = await boot({ pixellab: true });
    const ctx = context();
    const result = await icon.handler({ description: 'une bouée orange sur fond sombre', size: 128, transparent: true }, ctx);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(safeFetch).mock.calls[0]?.[0]).toBe('https://api.pixellab.ai/v2/create-image-pixflux');
    const init = vi.mocked(safeFetch).mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}-pixel`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ description: 'pixel art icon, une bouée orange sur fond sombre', image_size: { width: 128, height: 128 }, no_background: true });
    expect(ctx.sendFile).toHaveBeenCalledTimes(1);
    expect(ctx.sendFile.mock.calls[0]?.[0].name).toMatch(/^pixel-icon-\d+\.png$/u);
    expect(result).toMatchObject({ ok: true, summary: expect.stringContaining('$0.02') });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});

describe('image.compose · carte locale', () => {
  it('aucune clé : la carte part en pièce jointe', async () => {
    const { compose } = await boot({});
    const ctx = context();
    expect(await compose.handler({ title: 'Bienvenue', subtitle: 'À bord' }, ctx)).toMatchObject({ ok: true, summary: 'Carte « Bienvenue » envoyée en pièce jointe.', data: { width: 600, height: 240 } });
    expect(ctx.sendFile.mock.calls[0]?.[0]).toMatchObject({ name: expect.stringMatching(/^card-\d+\.png$/u), attachment: Buffer.from('carte') });
  });
});
