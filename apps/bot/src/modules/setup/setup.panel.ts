import type { GuildConfig } from '@10cordes/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { panel } from '../../shared/ui';
import { SETUP_LANGUAGE_SELECT_ID, SETUP_WELCOME_CHANNEL_ID, SETUP_WELCOME_TOGGLE_ID } from './setup.ids';

type AsyncTranslate = (key: string, vars?: Record<string, string | number>) => Promise<string>;

export interface SetupReply {
  components: [
    ContainerBuilder,
    ActionRowBuilder<StringSelectMenuBuilder>,
    ActionRowBuilder<ChannelSelectMenuBuilder>,
    ActionRowBuilder<ButtonBuilder>,
  ];
}

/** Construit la réponse complète du /setup (container + action rows) — partagée par la commande et les handlers. */
export async function buildSetupReply(config: GuildConfig, t: AsyncTranslate): Promise<SetupReply> {
  const container = panel({
    title: await t('setup.title'),
    lines: [
      await t('setup.welcome.line', {
        state: config.welcome.enabled ? await t('setup.welcome.enabled') : await t('setup.welcome.disabled'),
        channel: config.welcome.channelId ? `<#${config.welcome.channelId}>` : '—',
      }),
      await t('setup.language.line', { locale: config.defaultLocale }),
    ],
    footer: await t('setup.footer'),
  });

  const languageRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SETUP_LANGUAGE_SELECT_ID)
      .setPlaceholder('Langue par défaut du serveur')
      .addOptions(
        { label: 'Français', value: 'fr' },
        { label: 'English', value: 'en' },
      ),
  );

  const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(SETUP_WELCOME_CHANNEL_ID)
      .setPlaceholder('Salon de bienvenue'),
  );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETUP_WELCOME_TOGGLE_ID)
      .setLabel('👋 Welcome on/off')
      .setStyle(ButtonStyle.Primary),
  );

  return {
    components: [container, languageRow, channelRow, buttonRow],
  };
}
