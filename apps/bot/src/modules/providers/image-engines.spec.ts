import { describe, expect, it, vi } from 'vitest';
import type { GuildIntegrationService } from '../integrations/guild-integration.service';
import type { CapabilityRouterService, RouteAttempt } from './capability-router.service';
import { describeImageEngines, imageEnginesLine, pixelLabCredentials } from './image-engines';

/**
 * Moteurs d'image d\u0027un serveur : la ligne que l\u0027agent lit pour arbitrer
 * entre PixelLab (pixel art) et le modèle d\u0027IA routé. Elle ne dit que ce
 * qui est réellement utilisable : une intégration sans clé n\u0027y figure pas.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';

type Routed = { provider: { slug: string }; modelId: string };

function router(routes: Partial<Record<'image.generate' | 'image.edit', Routed | null>>) {
  return { resolve: vi.fn(async (_guildId: string, capability: string) => routes[capability as keyof typeof routes] ?? null) };
}

function integrations(active: boolean) {
  return {
    active: vi.fn(async () => active),
    resolve: vi.fn(async () => ({ slug: 'pixellab', enabled: true, origin: active ? 'instance' : 'none', config: active ? { apiKey: `${KEY}-pixel` } : {} })),
  };
}

const line = (routed: Partial<Record<'image.generate' | 'image.edit', Routed | null>>, pixelLab: boolean) =>
  imageEnginesLine(router(routed) as unknown as CapabilityRouterService, integrations(pixelLab) as unknown as GuildIntegrationService, GUILD);

describe('describeImageEngines', () => {
  const prefix = 'MOTEURS D\u0027IMAGE de ce serveur : ';

  it('aucun moteur : refus honnête demandé', () => {
    expect(describeImageEngines({ pixellab: false, generate: null, edit: null })).toBe(`${prefix}AUCUN. Une demande d\u0027image reçoit un refus honnête en une phrase (jamais d\u0027invention).`);
  });

  it('PixelLab seul : pixel art seulement, et les outils qui vont avec', () => {
    const text = describeImageEngines({ pixellab: true, generate: null, edit: null });
    expect(text).toContain('PixelLab ACTIF');
    expect(text).toContain('image.icon');
    expect(text).toContain('image.emoji');
    expect(text).not.toContain('generateImage');
  });

  it('un modèle d\u0027IA routé seul : pas de pixel art', () => {
    const text = describeImageEngines({ pixellab: false, generate: 'kie-ai / z-image', edit: null });
    expect(text).toContain('image.generate → kie-ai / z-image');
    expect(text).toContain('generateImage');
    expect(text).not.toContain('PixelLab');
    expect(text).not.toContain('image.edit');
  });

  it('les deux : l\u0027agent arbitre', () => {
    const text = describeImageEngines({ pixellab: true, generate: 'kie-ai / z-image', edit: 'kie-ai / z-image' });
    expect(text).toContain('PixelLab ACTIF');
    expect(text).toContain('image.generate → kie-ai / z-image');
    expect(text).toContain('image.edit → kie-ai / z-image');
  });
});

describe('imageEnginesLine', () => {
  it('ne retient que les routes qui existent et l\u0027intégration active', async () => {
    expect(await line({ 'image.generate': { provider: { slug: 'kie-ai' }, modelId: 'z-image' } }, true)).toBe(
      'MOTEURS D\u0027IMAGE de ce serveur : PixelLab ACTIF (pixel art, sprites, icônes, émojis : image.icon pour une icône, image.emoji pour un émoji) ; image.generate → kie-ai / z-image (outil generateImage : tout autre rendu que le pixel art).',
    );
    expect(await line({}, false)).toContain('AUCUN');
  });

  it('une route illisible ne fait pas échouer la ligne', async () => {
    const broken = { resolve: vi.fn(async () => Promise.reject(new Error('base illisible'))), attemptsOf: vi.fn((): RouteAttempt[] => []) };
    expect(await imageEnginesLine(broken as unknown as CapabilityRouterService, integrations(true) as unknown as GuildIntegrationService, GUILD)).toContain('PixelLab ACTIF');
  });
});

describe('pixelLabCredentials', () => {
  it('la clé de l\u0027intégration et son URL, ou l\u0027URL par défaut', async () => {
    const active = { resolve: vi.fn(async () => ({ slug: 'pixellab', enabled: true, origin: 'guild', config: { apiKey: `${KEY}-pixel`, baseUrl: 'https://guild.example.test/' } })) };
    expect(await pixelLabCredentials(active as unknown as GuildIntegrationService, GUILD, 'https://api.pixellab.ai')).toEqual({ apiKey: `${KEY}-pixel`, baseUrl: 'https://guild.example.test/', modelId: '' });
    const bare = { resolve: vi.fn(async () => ({ slug: 'pixellab', enabled: true, origin: 'instance', config: { apiKey: `${KEY}-pixel` } })) };
    expect(await pixelLabCredentials(bare as unknown as GuildIntegrationService, null, 'https://api.pixellab.ai')).toEqual({ apiKey: `${KEY}-pixel`, baseUrl: 'https://api.pixellab.ai', modelId: '' });
  });

  it('intégration désactivée ou sans clé, ou illisible : rien', async () => {
    const off = { resolve: vi.fn(async () => ({ slug: 'pixellab', enabled: false, origin: 'guild', config: { apiKey: `${KEY}-pixel` } })) };
    expect(await pixelLabCredentials(off as unknown as GuildIntegrationService, GUILD, 'https://api.pixellab.ai')).toBeNull();
    const none = { resolve: vi.fn(async () => ({ slug: 'pixellab', enabled: true, origin: 'none', config: {} })) };
    expect(await pixelLabCredentials(none as unknown as GuildIntegrationService, GUILD, 'https://api.pixellab.ai')).toBeNull();
    const broken = { resolve: vi.fn(async () => Promise.reject(new Error('clé maîtresse changée'))) };
    expect(await pixelLabCredentials(broken as unknown as GuildIntegrationService, GUILD, 'https://api.pixellab.ai')).toBeNull();
  });
});
