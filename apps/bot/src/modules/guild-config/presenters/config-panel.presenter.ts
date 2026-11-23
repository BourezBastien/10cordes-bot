import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type TextDisplayBuilder } from 'discord.js';
import { notice } from '../../../shared/ui';

/**
 * Vue du panneau de configuration d'un serveur : UNIQUEMENT ce qui est
 * réellement appliqué sur CE serveur (règles, compétences appliquées,
 * intégrations connectées avec leurs modèles, mode thinking). Jamais les
 * clés, jamais le catalogue des recettes de la bibliothèque, jamais les
 * sections de configuration legacy.
 */

export type AppliedSkillOrigin = 'custom' | 'library';

export interface ConfigPanelView {
  guildName: string;
  rulesLines: string[];
  skills: {
    /** Compétences créées par le staff (custom) et recettes déjà utilisées par l'agent (library). */
    applied: Array<{ trigger: string; uses: number; origin: AppliedSkillOrigin }>;
    /** La liste a été tronquée (plus de compétences appliquées que ce qui est montré). */
    appliedTruncated: boolean;
    /** Nombre total de recettes de la bibliothèque disponibles (non listées). */
    libraryTotal: number;
    /** Recettes de la bibliothèque déjà utilisées par l'agent sur ce serveur. */
    libraryApplied: number;
  };
  integrations: Array<{ label: string; connected: boolean; model?: string | null }>;
  llm: { connected: boolean; model: string | null; source: 'env' | 'modal' | 'none' };
  thinkingMode: 'adaptive' | 'always' | 'off';
  threadCreated: boolean;
}

/** Presenter PUR : vue → payload Components V2 (zéro I/O, zéro secret). */
export class ConfigPanelPresenter {
  render(view: ConfigPanelView): { flags: MessageFlags; components: TextDisplayBuilder[] } {
    const blocks: TextDisplayBuilder[] = [];

    blocks.push(
      notice(`## ⚙️ Configuration de ${view.guildName}\nCe qui est réellement appliqué sur ce serveur.`).components[0],
    );

    // Règles du serveur
    blocks.push(
      notice(
        `**Règles du serveur**\n${
          view.rulesLines.length > 0 ? view.rulesLines.map((line) => `- ${line}`).join('\n') : '- aucune règle spécifique (mention stricte par défaut)'
        }`,
      ).components[0],
    );

    // Compétences appliquées : jamais le catalogue, seulement ce qui a servi.
    const skillLines = view.skills.applied.map((skill) => {
      const uses = skill.uses > 0 ? `${skill.uses} util.` : 'pas encore utilisée';
      return `- ${skill.trigger} (${uses})`;
    });
    const more = view.skills.appliedTruncated ? `\n- … et d\u0027autres` : '';
    const catalogLine =
      view.skills.libraryTotal > 0
        ? `Recettes de la bibliothèque disponibles : ${view.skills.libraryTotal}${view.skills.libraryApplied > 0 ? `, dont ${view.skills.libraryApplied} déjà utilisées` : ''} (non listées, demande « cherche une recette pour … »).`
        : '';
    blocks.push(
      notice(
        `**Compétences appliquées** (${view.skills.applied.length})\n${skillLines.length > 0 ? skillLines.join('\n') : '- aucune pour l\u0027instant'}${more}\n${catalogLine}`,
      ).components[0],
    );

    // Intégrations actives : modèle OUI, clé JAMAIS.
    const integrationLines = view.integrations
      .map((integration) => {
        return `- ${integration.label} : ${
          integration.connected ? `**connecté**${integration.model ? ` · modèle \`${integration.model}\`` : ''}` : 'non connecté'
        }`;
      })
      .join('\n');
    const llmSource = view.llm.source === 'env' ? 'bootstrap env' : view.llm.source === 'modal' ? 'configuré depuis Discord' : '';
    blocks.push(
      notice(
        `**Intégrations**\n${integrationLines}\n- Agent IA : ${
          view.llm.connected ? `**connecté** · modèle \`${view.llm.model ?? 'défaut du fournisseur'}\`${llmSource ? ` (${llmSource})` : ''}` : 'non connecté'
        }\n- Thinking : \`${view.thinkingMode}\` (adaptive = activé seulement pendant l\u0027exécution de tools ou de compétences)`,
      ).components[0],
    );

    return { flags: MessageFlags.IsComponentsV2, components: blocks };
  }

  /** Bouton de connexion IA (utilisé quand le LLM n'est pas connecté). */
  connectButton(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('integration:llm:open').setLabel('Connecter un fournisseur IA').setStyle(ButtonStyle.Primary),
    );
  }

  /** Payload final prêt à l'envoi : panneau + bouton de connexion si besoin. */
  renderComplete(view: ConfigPanelView): { flags: MessageFlags; components: unknown[] } {
    const payload = this.render(view);
    const components = [...payload.components, ...(view.llm.connected ? [] : [this.connectButton()])];
    return { flags: payload.flags, components };
  }
}
