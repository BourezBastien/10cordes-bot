import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, TextDisplayBuilder } from 'discord.js';

/**
 * Vue du panneau de configuration d'un serveur : UNIQUEMENT ce qui est
 * réellement ACTIF sur CE serveur (règles, skills appliqués, intégrations
 + modèle), jamais les clés ni la vieille config morte (welcome/tickets/...).
 */
export interface ConfigPanelView {
  guildName: string;
  rulesLines: string[];
  skills: { total: number; top: Array<{ trigger: string; uses: number }> };
  integrations: Array<{ label: string; connected: boolean; model?: string | null }>;
  llm: { connected: boolean; model: string | null; source: 'env' | 'modal' | 'none' };
  thinkingMode: 'adaptive' | 'always' | 'off';
  threadCreated: boolean;
}

/** Presenter PUR : vue → payload Components V2 (zéro I/O, zéro secret). */
export class ConfigPanelPresenter {
  render(view: ConfigPanelView): { flags: MessageFlags; components: unknown[] } {
    const blocks: Array<TextDisplayBuilder | ActionRowBuilder<ButtonBuilder>> = [];

    blocks.push(
      new TextDisplayBuilder().setContent(
        `## ⚙️ Configuration de ${view.guildName}\nCe qui est réellement actif sur ce serveur.`,
      ),
    );

    // Règles serveur
    blocks.push(
      new TextDisplayBuilder().setContent(
        `**Règles du serveur**\n${view.rulesLines.length > 0 ? view.rulesLines.map((line) => `- ${line}`).join('\n') : '- aucune règle spécifique (mention stricte par défaut)'}`,
      ),
    );

    // Skills appliqués
    const topSkills =
      view.skills.top.length > 0 ? view.skills.top.map((skill) => `- ${skill.trigger} (${skill.uses} util.)`).join('\n') : '- aucun skill personnalisé';
    blocks.push(
      new TextDisplayBuilder().setContent(
        `**Skills appliqués** (${view.skills.total} actifs)\n${view.skills.top.length > 0 ? topSkills.slice(0, 1200) : topSkills}\n${view.skills.total > view.skills.top.length ? `- … et ${view.skills.total - view.skills.top.length} autres (liste complète : « liste mes skills »)` : ''}`,
      ),
    );

    // Intégrations actives (modèle OUI, clé JAMAIS)
    const integrationLines = view.integrations
      .map((integration) => `- ${integration.label} : ${integration.connected ? `**connecté**${integration.model ? ` · modèle \`${integration.model}\`` : ''}` : 'non connecté'}`)
      .join('\n');
    blocks.push(
      new TextDisplayBuilder().setContent(
        `**Intégrations**\n${integrationLines}\n- Agent IA : ${view.llm.connected ? `**connecté** · modèle \`${view.llm.model ?? 'défaut fournisseur'}\` (${view.llm.source === 'env' ? 'bootstrap env' : 'configuré depuis Discord'})` : 'non connecté (bouton « Connecter un fournisseur IA »)'}\n- Thinking : \`${view.thinkingMode}\` (adaptive = activé seulement quand des tools/compétences s\u0027exécutent)`,
      ),
    );

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [...blocks],
    };
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
    const components = [...(payload.components as unknown[]), ...(view.llm.connected ? [] : [this.connectButton()])];
    return { flags: payload.flags, components };
  }
}
