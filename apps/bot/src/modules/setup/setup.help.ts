import { Ctx, SlashCommand, SlashCommandHandler, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { ContainerBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, type ChatInputCommandInteraction } from 'discord.js';
import { text } from '../../shared/ui';
import { MODULE_CATALOG } from '../module-manager/module.catalog';
import { SetupCommand } from './setup.schema';

/** /help : présentation complète du bot en panneau V2 structuré. */
@SlashCommand({
  name: 'help',
  description: "Qui est 10cordes, commandes et capacités de l'agent IA.",
  dmPermission: false,
})
export class HelpCommand {}

@SlashCommandHandler(HelpCommand)
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class HelpHandler {
  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [buildHelpContainer()],
    });
  }
}

function buildHelpContainer(): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(0xd9_59_26);

  // Identité
  container.addTextDisplayComponents(
    text('## 🤖 10cordes — ton administrateur Discord délégué'),
    text(
      [
        "Je ne suis pas un bot à commandes : je suis un **agent IA** qui pilote ton serveur pour toi.",
        'Tu me parles en langage naturel, je vérifie tes permissions, j\'agis avec mes tools, et je confirme avec toi avant tout acte destructeur.',
      ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Parler à l'agent
  container.addTextDisplayComponents(text('### 💬 Parler à l\'agent'));
  container.addTextDisplayComponents(
    text(
      [
        '- **Mentionne-moi** : `@10cordes active le système de niveaux`',
        '- **Réponds à l\'une de mes réponses** : la conversation continue',
        '- **Salon dédié IA** : configure-le via `/setup` → Agent IA, tout ce qui y est écrit m\'arrive',
        '- Je consulte ma **mémoire** (serveur + membres), je retiens vos préférences et vos règles',
      ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Ce que je sais faire
  container.addTextDisplayComponents(text('### 🛠️ Ce que je sais faire'));
  container.addTextDisplayComponents(
    text(
      [
        '**Gestion** : modules on/off, configuration complète, salons, rôles, permissions',
        '**Modération** : warns, timeouts, kick, ban (plans confirmés), purge de messages',
        '**Communauté** : bienvenue/départs, rôles-réactions, tickets, levels et récompenses, tags',
        '**Création** : icônes et emojis pixel art (PixelLab)',
        '**Mémoire** : je retiens les infos durables du serveur et de chaque membre',
      ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Commandes
  container.addTextDisplayComponents(text('### 🧰 Commandes'));
  container.addTextDisplayComponents(
    text(
      [
        '**`/setup`** — panneau de contrôle V2 : toutes les options par catégorie',
        '**`/lang`** — ta langue personnelle (fr/en, auto-détectée sinon)',
        '**`/help`** — cette aide',
        `**Modules** : ${MODULE_CATALOG.map((m) => `\`${m.id}\``).join(' · ')}`,
      ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Permissions
  container.addTextDisplayComponents(
    text(
      [
        '### 🔐 Permissions',
        'Chaque action vérifie tes permissions Discord (ManageGuild, ManageRoles, ModerateMembers, KickMembers, BanMembers...).',
        'Le destructeur passe par une **confirmation humaine** — tu vois une proposition, tu approuves, j\'exécute.',
      ].join('\n'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(text('-# 10cordes · agent Discord modulaire · docs : dépôt GitHub'));

  return container;
}
