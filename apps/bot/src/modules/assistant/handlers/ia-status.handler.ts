import { Ctx, SlashCommandHandler } from '@spraxium/common';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { LlmService } from '../llm.service';
import { ImagelabService } from '../../imagelab/imagelab.service';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

/** /setup agent status : état des intégrations IA et inventaire des tools. */
@SlashCommandHandler(SetupCommand, { group: 'agent', sub: 'status' })
export class IaStatusHandler {
  constructor(
    private readonly llm: LlmService,
    private readonly imagelab: ImagelabService,
    private readonly registry: ToolRegistryService,
  ) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const llm = this.llm.status();
    const iaLines =
      llm.source === 'none'
        ? ['**IA** : ❌ non connectée — mentionne le bot (owner) pour ouvrir la modale de connexion.']
        : [
            `**IA** : ✅ connectée (via ${llm.source === 'modal' ? 'modale' : 'variables d\'environnement'})`,
            `Fournisseur : ${llm.provider} · Modèle : \`${llm.model}\` · Clé : \`${llm.maskedKey}\``,
            `Base URL : ${llm.baseUrl}`,
          ];

    const pixellab = this.imagelab.configured
      ? '**PixelLab** : ✅ connecté (icônes et emojis pixel art)'
      : '**PixelLab** : ❌ clé absente (champ optionnel de la modale de connexion)';

    const byCategory = new Map<string, string[]>();
    for (const tool of this.registry.list()) {
      const list = byCategory.get(tool.category) ?? [];
      list.push(`\`${tool.name}\``);
      byCategory.set(tool.category, list);
    }
    const toolLines = [...byCategory.entries()].map(
      ([category, names]) => `**${category}** (${names.length}) : ${names.join(' · ')}`,
    );

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🤖 État de l\'agent IA',
          lines: [...iaLines, pixellab, `**Tools actifs** : ${this.registry.list().length}`, ...toolLines],
          footer: 'Tout est exécutable en langage naturel : mentionne le bot.',
        }),
      ],
    });
  }
}
