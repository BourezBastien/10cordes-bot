import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  type MessageCreateOptions,
  type TextDisplayBuilder,
} from 'discord.js';
import { notice, text, separator } from '../../../shared/ui';

/**
 * IntegrationStatusPresenter (A2) : rendu V2 du panneau « fournisseur IA ».
 * POO pure : reçoit des données, retourne un payload Discord prêt à envoyer
 * (drapeau IsComponentsV2 compris), zéro effet de bord. Le design s'inspire
 * de la hiérarchie visuelle du dashboard ARCHIVE-9 (bloc titre clair →
 * separator → corps → action) appliquée à nos Components V2.
 */

/** customId et label du bouton : source de vérité partagée avec la classe décorée du handler. */
export const INTEGRATION_LLM_BUTTON_ID = 'integration:llm:open';
export const INTEGRATION_LLM_BUTTON_LABEL = 'Connecter un fournisseur IA';

/** Bouton d'ouverture en rangée (même customId que la classe décorée). */
export function integrationOpenButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(INTEGRATION_LLM_BUTTON_ID).setLabel(INTEGRATION_LLM_BUTTON_LABEL).setStyle(ButtonStyle.Primary),
  );
}

export interface IntegrationStatusView {
  /** Nom lisible de l'intégration (ex : « Fournisseur IA »). */
  label: string;
  /** L'intégration est-elle connectée ? */
  connected: boolean;
  /** L'utilisateur peut-il configurer (owner ou Administrator) ? */
  canConfigure: boolean;
  /** Détail optionnel quand connecté (modèle, source). */
  detail?: string;
}

export class IntegrationStatusPresenter {
  private static readonly ACCENT = 0xd9_59_26;

  /**
   * Payload IS_COMPONENTS_V2 unique, jamais de double message.
   * - Non connecté + admin : titre + explication + bouton « Connecter »
   * - Non connecté + non admin : titre + explication + ligne « admin requis »
   * - Connecté : titre + statut + détail
   */
  render(view: IntegrationStatusView): MessageCreateOptions {
    const container = new ContainerBuilder().setAccentColor(IntegrationStatusPresenter.ACCENT);

    if (view.connected) {
      container.addTextDisplayComponents(text(`### ✅ ${view.label} connecté`));
      container.addSeparatorComponents(separator());
      const lines = [view.detail ?? 'Fournisseur opérationnel.'];
      container.addTextDisplayComponents(text(lines.join('\n')));
    } else {
      container.addTextDisplayComponents(text(`### 🔌 ${view.label} non connecté`));
      container.addSeparatorComponents(separator());
      container.addTextDisplayComponents(
        text(
          `Aucun modèle d'intelligence artificielle n'est encore configuré sur ce serveur. ` +
            'Tu peux connecter n\u0027importe quel fournisseur compatible OpenAI (OpenAI, DeepSeek, OpenRouter, etc.) ' +
            ': la clé API est chiffrée en AES-256-GCM.',
        ),
      );
      if (view.canConfigure) {
        container.addTextDisplayComponents(
          text('-# Clique le bouton ci-dessous pour ouvrir le formulaire de connexion.'),
        );
        container.addActionRowComponents(integrationOpenButton());
      } else {
        container.addTextDisplayComponents(
          text('Seul un administrateur du serveur peut configurer le fournisseur IA.'),
        );
      }
    }

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  /** Refus de la Policy (owner + Administrator) : éphémère, sans détail utile à un attaquant. */
  denied(): { flags: number; components: TextDisplayBuilder[] } {
    return notice('🚫 Seul un administrateur du serveur peut configurer le fournisseur IA.', true);
  }

  /** Confirmation après enregistrement : base URL et modèle, JAMAIS la clé. */
  saved(view: { baseUrl: string; model: string }): { flags: number; components: TextDisplayBuilder[] } {
    return notice(
      `✅ **Fournisseur IA connecté**\nBase URL : \`${view.baseUrl}\`\nModèle : \`${view.model || 'défaut du fournisseur'}\`\nLa clé est chiffrée (AES-256-GCM) et prend effet immédiatement.`,
      true,
    );
  }

  /** Échec de connexion ou d'enregistrement : éphémère, raison tronquée. */
  failure(reason: string): { flags: number; components: TextDisplayBuilder[] } {
    return notice(`❌ Échec de la connexion : ${reason.slice(0, 160)}`, true);
  }
}
