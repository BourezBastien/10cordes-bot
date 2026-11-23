import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@10cordes/shared';
import { buildSurfaceTools } from './surface.tools';

/**
 * surface.create, la porte d'entrée du moteur. Le modèle y testait l'outil
 * avec des surfaces « probe » laissées dans le salon : elles sont refusées
 * avant toute écriture, et un bouton sans pipeline ne passe jamais.
 */

const GUILD = '1550835980116824136';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';

function deps() {
  return {
    prisma: {
      interactiveSurface: {
        create: vi.fn().mockResolvedValue({ id: 'surface-1' }),
        findUnique: vi.fn().mockResolvedValue({ kind: 'custom', messageId: '1550000000000000004' }),
      },
    },
    audit: { record: vi.fn() },
    store: {},
    render: vi.fn(async () => undefined),
  };
}

const wired = () => ({ key: 'oui', label: 'Oui', pipeline: [{ type: 'replyEphemeral', content: 'Merci' }] });

const definition = (over: Record<string, unknown>, button: unknown = wired()): string =>
  JSON.stringify({ title: 'Sondage du soir', rows: [{ kind: 'buttons', buttons: [button] }], ...over });

const ctx = (): ToolRunContext => ({ guildId: GUILD, channelId: CHANNEL, userId: USER, locale: 'fr', permissions: ['ManageGuild'], reply: async () => undefined });

/** surface.create est le premier tool de la factory (ordre d'enregistrement documenté). */
const createTool = (d: ReturnType<typeof deps>) => buildSurfaceTools(d as never)[0];

const create = async (raw: string) => {
  const d = deps();
  const result = await createTool(d)?.handler({ channelId: CHANNEL, kind: 'custom', definition: raw }, ctx());
  return { d, result };
};

describe('surface.create · surfaces de sonde', () => {
  it.each(['probe', 'Probe', 'test', 'TEST', 'ping', 'placeholder'])('description « %s » : refusée, rien n\u0027est créé ni posté', async (word) => {
    const { d, result } = await create(definition({ description: word }));
    expect(result?.ok).toBe(false);
    expect(result?.summary).toContain('sonde');
    expect(d.prisma.interactiveSurface.create).not.toHaveBeenCalled();
    expect(d.render).not.toHaveBeenCalled();
  });

  it.each(['probe', 'test', 'démo'])('titre « %s » : refusé même au-dessus de 3 caractères', async (word) => {
    const { result } = await create(definition({ title: word }));
    expect(result?.ok).toBe(false);
    expect(result?.summary).toContain('sonde');
  });

  it('le mot « test » dans un vrai titre ou une vraie description reste autorisé', async () => {
    const { d, result } = await create(definition({ title: 'Sondage test du soir', description: 'Faut-il un test de son avant le live ?' }));
    expect(result?.ok).toBe(true);
    expect(d.prisma.interactiveSurface.create).toHaveBeenCalledTimes(1);
  });
});

describe('surface.create · boutons toujours câblés', () => {
  it('un bouton sans pipeline est refusé par le schéma, avant toute création', async () => {
    const { d, result } = await create(definition({}, { key: 'mort', label: 'Bouton mort' }));
    expect(result?.ok).toBe(false);
    expect(result?.summary).toContain('Définition invalide');
    expect(result?.summary).toContain('pipeline');
    expect(d.prisma.interactiveSurface.create).not.toHaveBeenCalled();
  });

  it('une rangée vide est refusée', async () => {
    const { result } = await create(JSON.stringify({ title: 'Sondage du soir', rows: [] }));
    expect(result?.ok).toBe(false);
    expect(result?.summary).toContain('rangée');
  });
});
