import { describe, expect, it, vi } from 'vitest';
import { ModalService } from '@spraxium/components';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

const mocks = vi.hoisted(() => ({ applyConfig: vi.fn() }));

vi.mock('../../assistant/llm.accessor', () => ({ getLlm: () => ({ applyConfig: mocks.applyConfig }) }));

import { INTEGRATION_LLM_BUTTON_ID, integrationOpenButton } from '../presenters/integration-status.presenter';
import {
  IntegrationConfigModal,
  IntegrationOpenButton,
  IntegrationOpenModalButtonHandler,
  IntegrationSaveModalHandler,
} from './integration.handlers';

/**
 * Le clic et la modale exigent une vraie interaction Discord (non simulable
 * par un rig REST). Ces tests garantissent le minimum qui manquait : les
 * métadonnées de routage du dispatcher, la garde Policy, et l'effet attendu.
 */

const OWNER = '1550000000000000001';
const OTHER = '1550000000000000002';
const FIELDS = { baseUrl: ' https://api.deepseek.com/ ', apiKey: 'sk-test-secret', model: 'deepseek-flash' };

interface FakeInteraction {
  id: string;
  reply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
}

function fakeInteraction({ admin = false, owner = false } = {}): FakeInteraction {
  // Objet plat : seules les méthodes appelées par les handlers sont fournies.
  return {
    id: 'interaction-1',
    user: { id: owner ? OWNER : OTHER },
    guild: { ownerId: OWNER },
    memberPermissions: { toArray: () => (admin ? ['Administrator'] : []) },
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    fields: { getTextInputValue: (id: string) => FIELDS[id as keyof typeof FIELDS] },
  } as unknown as FakeInteraction;
}

const asButton = (interaction: FakeInteraction) => interaction as unknown as ButtonInteraction;
const asModal = (interaction: FakeInteraction) => interaction as unknown as ModalSubmitInteraction;
const modals = () => new ModalService({} as never);

/** JSON du premier argument d'un appel de réponse (reply, editReply). */
const firstCallJson = (mock: ReturnType<typeof vi.fn>, index: number): string => JSON.stringify(mock.mock.calls[index][0]);

describe('routage des handlers d\u0027intégration (métadonnées du dispatcher)', () => {
  it('le bouton du panneau d\u0027accueil porte le même customId que la classe décorée', () => {
    expect(Reflect.getOwnMetadata('spraxium:button_component', IntegrationOpenButton)).toMatchObject({ customId: INTEGRATION_LLM_BUTTON_ID });
    const [button] = integrationOpenButton().toJSON().components;
    expect(button).toMatchObject({ style: 1, label: 'Connecter un fournisseur IA' });
    expect((button as { custom_id?: string }).custom_id).toBe(INTEGRATION_LLM_BUTTON_ID);
  });

  it('chaque handler est lié à son composant (la version sans décorateur ne répondait jamais)', () => {
    expect(Reflect.getOwnMetadata('spraxium:button_handler', IntegrationOpenModalButtonHandler)).toMatchObject({ component: IntegrationOpenButton });
    expect(Reflect.getOwnMetadata('spraxium:modal_handler', IntegrationSaveModalHandler)).toMatchObject({ builder: IntegrationConfigModal });
    expect(Reflect.getOwnMetadata('spraxium:modal_component', IntegrationConfigModal)).toMatchObject({ id: 'integration-config' });
  });

  it('la modale construite porte l\u0027id, le titre et les trois champs attendus', () => {
    // Le framework utilise des composants Label : le champ est sous `component`.
    const json = modals().build(IntegrationConfigModal).toJSON() as {
      custom_id: string;
      title: string;
      components: Array<{ label: string; component: { custom_id: string; required?: boolean } }>;
    };
    expect(json.custom_id).toBe('integration-config');
    expect(json.title).toBe('Connecter un fournisseur IA');
    expect(json.components.map((entry) => entry.component.custom_id)).toEqual(['baseUrl', 'apiKey', 'model']);
    expect(json.components[0].component.required).toBe(true);
    expect(json.components[2].component.required).toBe(false);
  });
});

describe('IntegrationOpenModalButtonHandler', () => {
  it('non administrateur : refus éphémère, aucune modale', async () => {
    const interaction = fakeInteraction();
    await new IntegrationOpenModalButtonHandler(modals()).handle(asButton(interaction));
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  it('propriétaire : la modale s\u0027ouvre sans réponse préalable (règle des 3 s)', async () => {
    const interaction = fakeInteraction({ owner: true });
    await new IntegrationOpenModalButtonHandler(modals()).handle(asButton(interaction));
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const [modal] = interaction.showModal.mock.calls[0] as unknown as [{ toJSON: () => { custom_id: string } }];
    expect(modal.toJSON().custom_id).toBe('integration-config');
  });

  it('administrateur (non propriétaire) : autorisé', async () => {
    const interaction = fakeInteraction({ admin: true });
    await new IntegrationOpenModalButtonHandler(modals()).handle(asButton(interaction));
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });
});

describe('IntegrationSaveModalHandler', () => {
  it('non administrateur : refus, rien n\u0027est enregistré', async () => {
    mocks.applyConfig.mockClear();
    const interaction = fakeInteraction();
    await new IntegrationSaveModalHandler().handle(asModal(interaction));
    expect(mocks.applyConfig).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('administrateur : applyConfig reçoit l\u0027URL normalisée et les champs, la réponse ne montre jamais la clé', async () => {
    mocks.applyConfig.mockResolvedValue(undefined);
    const interaction = fakeInteraction({ admin: true });
    await new IntegrationSaveModalHandler().handle(asModal(interaction));

    expect(mocks.applyConfig).toHaveBeenCalledWith('custom', 'https://api.deepseek.com', 'sk-test-secret', 'deepseek-flash');
    const payload = firstCallJson(interaction.editReply, 0);
    expect(payload).toContain('Fournisseur IA connecté');
    expect(payload).toContain('https://api.deepseek.com');
    expect(payload).toContain('deepseek-flash');
    expect(payload).not.toContain('sk-test-secret');
  });

  it('clé refusée par le fournisseur : la raison est renvoyée, sans la clé', async () => {
    mocks.applyConfig.mockRejectedValue(new Error('Connexion échouée (401) : clé invalide'));
    const interaction = fakeInteraction({ admin: true });
    await new IntegrationSaveModalHandler().handle(asModal(interaction));

    const payload = firstCallJson(interaction.editReply, 0);
    expect(payload).toContain('clé invalide');
    expect(payload).not.toContain('sk-test-secret');
  });
});
