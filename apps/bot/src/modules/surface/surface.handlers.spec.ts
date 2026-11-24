import { describe, expect, it, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { SurfaceActHandler, SurfaceModalHandler, SurfaceSelectHandler } from './surface.handlers';
import { MessageFlags } from 'discord.js';
import { MODAL_MAX_COMPONENTS } from '../../shared/ui/modal-limits';

/**
 * Clics et soumissions de surfaces. Un vrai clic exige une interaction Discord
 * (non simulable par un rig) : ces tests fixent ce qui manquait, à savoir
 * qu'AUCUN clic ne reste silencieux, et que la réponse éphémère d'un pipeline
 * n'est plus effacée dès qu'elle paraît.
 */

const GUILD = '1550835980116824136';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';
const MESSAGE = '1550000000000000004';

interface FakeInteraction {
  id: string;
  message?: { id: string };
  customId: string;
  values: string[];
  user: { id: string };
  guild: null;
  guildId: string;
  channelId: string;
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  deleteReply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
  isAnySelectMenu: () => boolean;
  fields: { getTextInputValue: (id: string) => string };
}

function fakeInteraction(overrides: Partial<FakeInteraction> = {}): FakeInteraction {
  return {
    id: 'interaction-1',
    message: { id: MESSAGE },
    customId: '',
    values: ['oui'],
    user: { id: USER },
    guild: null,
    guildId: GUILD,
    channelId: CHANNEL,
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    isAnySelectMenu: () => true,
    fields: { getTextInputValue: (id: string) => `valeur ${id}` },
    ...overrides,
  };
}

/** Textes Components V2 du dernier message éphémère envoyé (reply ou editReply). */
function lastEphemeralText(interaction: FakeInteraction): string {
  const call = [...interaction.editReply.mock.calls, ...interaction.reply.mock.calls].at(-1);
  const payload = call?.[0] as { components?: Array<{ toJSON(): { content?: string } }> };
  return payload?.components?.map((component) => component.toJSON().content ?? '').join('\n') ?? '';
}

/** Ce qu'un handler transmet au service pour une interaction. */
interface RunArgs {
  replyEphemeral: (content: string) => Promise<void>;
}

function harness(options: { binding?: unknown | null; run?: (args: RunArgs) => Promise<unknown> } = {}) {
  const binding = 'binding' in options ? options.binding : { key: 'oui', pipeline: [{ type: 'replyEphemeral', content: 'ok' }] };
  const surfaces = {
    loadSurface: vi.fn(async () => ({ definition: { rows: [] } })),
    findBindingFor: vi.fn(async () => binding),
    runInteraction: vi.fn(options.run ?? (async () => ({ ok: true, message: 'Exécuté.' }))),
  };
  const prisma = { interactiveSurface: { findFirst: vi.fn().mockResolvedValue({ id: 'surface-1' }) } };
  return { surfaces, prisma };
}

describe('SurfaceActHandler · routage', () => {
  it('porte les métadonnées du dispatcher (sans décorateur, un handler ne reçoit jamais rien)', () => {
    expect(Reflect.getOwnMetadataKeys(SurfaceActHandler).length).toBeGreaterThan(0);
    expect(Reflect.getOwnMetadataKeys(SurfaceSelectHandler).length).toBeGreaterThan(0);
    expect(Reflect.getOwnMetadataKeys(SurfaceModalHandler).length).toBeGreaterThan(0);
  });
});

describe('SurfaceActHandler · aucun clic ne reste silencieux', () => {
  it('surface absente : accusé direct « Cette action n\u0027est plus active », sans défèrement', async () => {
    const { surfaces, prisma } = harness();
    prisma.interactiveSurface.findFirst.mockResolvedValue(null);
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'oui' });
    expect(lastEphemeralText(interaction)).toContain('Cette action n\u0027est plus active');
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  it('binding disparu de la définition : même accusé, sans exécuter de pipeline', async () => {
    const { surfaces, prisma } = harness({ binding: null });
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'vieux-bouton' });
    expect(lastEphemeralText(interaction)).toContain('Cette action n\u0027est plus active');
    expect(surfaces.runInteraction).not.toHaveBeenCalled();
  });

  it('pipeline refusé : la raison est montrée au membre', async () => {
    const { surfaces, prisma } = harness({ run: async () => ({ ok: false, message: 'Solde insuffisant.' }) });
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'miser' });
    expect(lastEphemeralText(interaction)).toBe('Action impossible : Solde insuffisant.');
  });

  it('pipeline réussi sans réponse : « Action exécutée. », jamais un clic muet', async () => {
    const { surfaces, prisma } = harness();
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'oui' });
    expect(lastEphemeralText(interaction)).toBe('Action exécutée.');
  });

  it('l\u0027accusé différé est éphémère ET Components V2 dès la création', async () => {
    const { surfaces, prisma } = harness();
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'oui' });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
  });

  it('une exception du pipeline est rattrapée, journalisée et répondue', async () => {
    const { surfaces, prisma } = harness({ run: async () => { throw new Error('boom'); } });
    const interaction = fakeInteraction({ id: 'interaction-9' });
    await expect(
      new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'oui' }),
    ).resolves.toBeUndefined();
    expect(lastEphemeralText(interaction)).toContain('Cette action a échoué [interaction-9]');
  });
});

describe('SurfaceActHandler · la réponse du pipeline reste visible (régression du bouton muet)', () => {
  it('la réponse éphémère du pipeline n\u0027est JAMAIS supprimée ni remplacée', async () => {
    const { surfaces, prisma } = harness({
      run: async (args: { replyEphemeral: (content: string) => Promise<void> }) => {        await args.replyEphemeral('Confirmé : le bot va relancer l\u0027action, elle passera cette fois.');
        return { ok: true, message: 'Exécuté.' };
      },
    });
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'confirmer' });
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(lastEphemeralText(interaction)).toBe('Confirmé : le bot va relancer l\u0027action, elle passera cette fois.');
    const allTexts = interaction.editReply.mock.calls.map((call) => (call[0] as { components: Array<{ toJSON(): { content?: string } }> }).components[0]?.toJSON().content);
    expect(allTexts).toEqual(['Confirmé : le bot va relancer l\u0027action, elle passera cette fois.']);
  });
});

describe('SurfaceActHandler · modale', () => {
  it('openModal en première étape : showModal est la PREMIÈRE réponse, aucun defèrement avant', async () => {
    const { surfaces, prisma } = harness({
      binding: {
        key: 'miser',
        pipeline: [
          {
            type: 'openModal',
            modal: { title: 'Mise', inputs: [{ id: 'montant', label: 'Montant', style: 'short', required: true }] },
          },
        ],
      },
    });
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'miser' });
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('cinq entrées, le maximum du schéma : la modale reste dans la limite de Discord', async () => {
    const inputs = Array.from({ length: 5 }, (_, index) => ({ id: `champ${index}`, label: `Champ ${index + 1}`, style: 'short' as const, required: false }));
    const { surfaces, prisma } = harness({ binding: { key: 'formulaire', pipeline: [{ type: 'openModal', modal: { title: 'Formulaire', inputs } }] } });
    const interaction = fakeInteraction();
    await new SurfaceActHandler(surfaces as never, prisma as never).handle(interaction as unknown as ButtonInteraction, { b: 'formulaire' });
    const shown = interaction.showModal.mock.calls[0]?.[0] as unknown as { toJSON: () => { components: unknown[] } };
    expect(shown.toJSON().components.length).toBeLessThanOrEqual(MODAL_MAX_COMPONENTS);
  });
});

describe('SurfaceSelectHandler et SurfaceModalHandler', () => {
  it('sélection : pipeline exécuté pour chaque option, réponse visible', async () => {
    const { surfaces, prisma } = harness();
    const interaction = fakeInteraction({ values: ['a', 'b'] });
    await new SurfaceSelectHandler(surfaces as never, prisma as never).handle(interaction as never);
    expect(surfaces.runInteraction).toHaveBeenCalledTimes(2);
    expect(lastEphemeralText(interaction)).toBe('Action exécutée.');
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });

  it('sélection sans valeur ni message : accusé direct', async () => {
    const { surfaces, prisma } = harness();
    const interaction = fakeInteraction({ values: [] });
    interaction.message = undefined;
    await new SurfaceSelectHandler(surfaces as never, prisma as never).handle(interaction as never);
    expect(lastEphemeralText(interaction)).toContain('Cette action n\u0027est plus active');
    expect(prisma.interactiveSurface.findFirst).not.toHaveBeenCalled();
  });

  it('soumission de modale dont le binding n\u0027ouvre plus de modale : accusé « plus active »', async () => {
    const { surfaces } = harness({ binding: { key: 'miser', pipeline: [{ type: 'replyEphemeral', content: 'ok' }] } });
    const interaction = fakeInteraction({ customId: 'surface:modal~s=surface-1~b=miser' });
    await new SurfaceModalHandler(surfaces as never).handle(interaction as never);
    expect(lastEphemeralText(interaction)).toContain('Cette action n\u0027est plus active');
    expect(surfaces.runInteraction).not.toHaveBeenCalled();
  });

  it('soumission de modale valide : champs relus depuis la spec, pipeline exécuté', async () => {
    const field = { id: 'montant', label: 'Montant', style: 'short' as const, required: true };
    const { surfaces } = harness({ binding: { key: 'miser', pipeline: [{ type: 'openModal', modal: { title: 'Mise', inputs: [field] } }] } });
    const interaction = fakeInteraction({ customId: 'surface:modal~s=surface-1~b=miser', fields: { getTextInputValue: () => '25' } });
    await new SurfaceModalHandler(surfaces as never).handle(interaction as never);
    expect(surfaces.runInteraction).toHaveBeenCalledWith(expect.objectContaining({ surfaceId: 'surface-1', bindingKey: 'miser', inputs: { montant: '25' } }));
    expect(lastEphemeralText(interaction)).toBe('Action exécutée.');
  });
});
