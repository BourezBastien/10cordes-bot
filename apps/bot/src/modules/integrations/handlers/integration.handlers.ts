import { Ctx } from '@spraxium/common';
import { Button, ButtonHandler, ModalComponent, ModalHandler, ModalInput, ModalService } from '@spraxium/components';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { Logger } from '@spraxium/logger';
import { guildAdminPolicy, type GuildAccessContext } from '../../../core/security/access-policy';
import { getLlm } from '../../assistant/llm.accessor';
import { normalizeBaseUrl } from '../../assistant/llm.service';
import { fileLog } from '../../logging/file-log.service';
import { IntegrationStatusPresenter } from '../presenters/integration-status.presenter';

/**
 * Handlers d'intégrations : le seul point d'entrée UI pour connecter un
 * fournisseur IA depuis Discord.
 *
 *   bouton integration:llm:open  →  modale integration-config  →  LlmService.applyConfig
 *
 * Les décorateurs de @spraxium/components sont OBLIGATOIRES : le dispatcher
 * route une interaction grâce aux métadonnées des classes. La version
 * précédente était faite de classes nues, inscrites au boot mais sans
 * décorateur : le bouton n'a jamais répondu.
 *
 * Répartition : Policy pour l'accès (GuildAdminPolicy : owner ou
 * Administrator), Presenter pur pour les messages, service pour l'effet.
 */

const log = new Logger('IntegrationHandlers');

/** customId et label du bouton : source de vérité partagée avec le panneau d'accueil. */
export const INTEGRATION_LLM_BUTTON_ID = 'integration:llm:open';
export const INTEGRATION_LLM_BUTTON_LABEL = 'Connecter un fournisseur IA';

@Button({ customId: INTEGRATION_LLM_BUTTON_ID, label: INTEGRATION_LLM_BUTTON_LABEL, style: 'primary' })
export class IntegrationOpenButton {}

@ModalComponent({ id: 'integration-config', title: INTEGRATION_LLM_BUTTON_LABEL })
export class IntegrationConfigModal {
  @ModalInput({
    id: 'baseUrl',
    label: 'Base URL de l\u0027API (compatible OpenAI)',
    style: 'short',
    required: true,
    placeholder: 'https://api.deepseek.com ou https://openrouter.ai/api/v1',
  })
  baseUrl!: string;

  @ModalInput({ id: 'apiKey', label: 'Clé API (chiffrée AES-256-GCM)', style: 'paragraph', required: true, placeholder: 'sk-...' })
  apiKey!: string;

  @ModalInput({ id: 'model', label: 'Modèle (optionnel)', style: 'short', required: false, placeholder: 'deepseek-flash, gpt-4o-mini...' })
  model!: string;
}

/** Bouton d'ouverture en rangée, pour le panneau d'accueil (même customId que la classe décorée). */
export function integrationOpenButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(INTEGRATION_LLM_BUTTON_ID).setLabel(INTEGRATION_LLM_BUTTON_LABEL).setStyle(ButtonStyle.Primary),
  );
}

/** Un échec de réponse à une interaction doit rester diagnostiquable (jamais avalé). */
function report(step: string, interactionId: string) {
  return (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`${step} impossible (${message.slice(0, 140)})`);
    fileLog()?.event('warn', 'integrations', 'interaction_failed', { step, interactionId, error: message.slice(0, 200) });
  };
}

/** Contexte d'accès exigé par la Policy, dérivé du membre qui interagit. */
function accessContext(interaction: ButtonInteraction | ModalSubmitInteraction): GuildAccessContext | null {
  const guild = interaction.guild;
  if (!guild) return null;
  return {
    userId: interaction.user.id,
    guildOwnerId: guild.ownerId,
    permissions: interaction.memberPermissions?.toArray() ?? [],
  };
}

/** Ouvre la modale de configuration (owner ou Administrator). */
@ButtonHandler(IntegrationOpenButton)
export class IntegrationOpenModalButtonHandler {
  // Presenter pur : champ de classe, jamais un paramètre de constructeur DI.
  private readonly presenter = new IntegrationStatusPresenter();

  constructor(private readonly modals: ModalService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const ctx = accessContext(interaction);
    if (!ctx) return;
    if (!guildAdminPolicy.isAuthorized(ctx)) {
      await interaction.reply(this.presenter.denied()).catch(report('refus', interaction.id));
      return;
    }
    // showModal doit être la PREMIÈRE réponse de l'interaction (règle des 3 s).
    await interaction.showModal(this.modals.build(IntegrationConfigModal)).catch(report('modale', interaction.id));
  }
}

/** Enregistre la clé : contrôle de connexion, chargement immédiat, persistance chiffrée. */
@ModalHandler(IntegrationConfigModal)
export class IntegrationSaveModalHandler {
  private readonly presenter = new IntegrationStatusPresenter();

  async handle(@Ctx() interaction: ModalSubmitInteraction): Promise<void> {
    const ctx = accessContext(interaction);
    if (!ctx) return;
    if (!guildAdminPolicy.isAuthorized(ctx)) {
      await interaction.reply(this.presenter.denied()).catch(report('refus', interaction.id));
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(report('defer', interaction.id));

    const baseUrl = normalizeBaseUrl(interaction.fields.getTextInputValue('baseUrl'));
    const apiKey = interaction.fields.getTextInputValue('apiKey').trim();
    const model = interaction.fields.getTextInputValue('model')?.trim() ?? '';

    try {
      // applyConfig : GET /models de contrôle, runtime LLM rechargé (effet
      // immédiat, sans redémarrage) puis persistance chiffrée. Passer par
      // IntegrationService.upsert seul laisserait l'ancienne clé en mémoire.
      await getLlm().applyConfig('custom', baseUrl, apiKey, model);
      await interaction.editReply(this.presenter.saved({ baseUrl, model })).catch(report('confirmation', interaction.id));
    } catch (error) {
      await interaction.editReply(this.presenter.failure(error instanceof Error ? error.message : String(error))).catch(report('échec', interaction.id));
    }
  }
}
