import { ContainerBuilder } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { text, separator } from '../../../shared/ui';

/**
 * IntegrationStatusPresenter (A2) — rendu V2 du panneau « fournisseur IA ».
 * POO pure : reçoit des données, retourne un payload Discord, zéro effet
 * de bord. Le design s'inspire de la hiérarchie visuelle du dashboard
 * ARCHIVE-9 (bloc titre clair → separator → corps → action) appliquée
 * à nos Components V2.
 */

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
   * Payload IS_COMPONENTS_V2 unique — jamais de double message.
   * - Non connecté + admin → titre + explication + bouton « Connecter »
   * - Non connecté + non-admin → titre + explication + ligne « admin requis »
   * - Connecté → titre + statut + détail
   */
  render(view: IntegrationStatusView): {
    flags: MessageFlags;
    components: ContainerBuilder[];
  } {
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
            '— la clé API est chiffrée en AES-256-GCM.',
        ),
      );
      if (view.canConfigure) {
        // Le bouton est ajouté par le caller (ActionRow + DynamicButton)
        // pour garder ce Presenter pur de tout import discord.js builder.
        container.addTextDisplayComponents(
          text('-# Clique le bouton ci-dessous pour ouvrir le formulaire de connexion.'),
        );
      } else {
        container.addTextDisplayComponents(
          text('Seul un administrateur du serveur peut configurer le fournisseur IA.'),
        );
      }
    }

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }
}
