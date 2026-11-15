import { Ctx, SlashCommandHandler, SlashStringOption, UseGuards } from '@spraxium/common';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { LocaleService } from '../locale.service';
import { LanguageCommand } from '../commands/language.command';
import { panel } from '../../../shared/ui';

@SlashCommandHandler(LanguageCommand, { sub: 'set' })
export class LanguageSetHandler {
  constructor(private readonly locales: LocaleService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('locale') locale: string,
  ): Promise<void> {
    await this.locales.set(interaction.user.id, locale === 'en' ? 'en' : 'fr');
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: locale === 'en' ? '## ✅ Language updated' : '## ✅ Langue mise à jour',
          lines: [locale === 'en' ? 'Your language is now **English**.' : 'Votre langue est maintenant le **français**.'],
          accentColor: 0x57_f2_87,
          footer: locale === 'en' ? 'This setting follows YOU, not the server.' : 'Ce réglage vous suit, vous — pas le serveur.',
        }),
      ],
    });
  }
}

@SlashCommandHandler(LanguageCommand, { sub: 'view' })
export class LanguageViewHandler {
  constructor(private readonly locales: LocaleService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const locale = await this.locales.resolve(interaction.user.id);
    const source = await this.locales.getSource(interaction.user.id);
    const sourceLabel = source === 'manual' ? 'choisie via /language' : source === 'auto' ? 'détectée du client Discord' : 'défaut';
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🌍 Votre langue',
          lines: [`**\`${locale}\`** (${sourceLabel})`],
          footer: 'Modifier : /language set · Réinitialiser : /language reset',
        }),
      ],
    });
  }
}

@SlashCommandHandler(LanguageCommand, { sub: 'reset' })
export class LanguageResetHandler {
  constructor(private readonly locales: LocaleService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    await this.locales.reset(interaction.user.id);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🔄 Langue réinitialisée',
          lines: ['Retour à la détection automatique depuis votre client Discord.'],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
