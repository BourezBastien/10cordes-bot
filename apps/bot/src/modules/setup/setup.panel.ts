import type { LlmStatus } from '../assistant/llm.service';
import type { ContainerBuilder } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { CONFIG_KEYS, type GuildConfig } from '@10cordes/shared';
import { MODULE_CATALOG } from '../module-manager/module.catalog';
import { IA_CONFIG_BUTTON_ID } from '../assistant/components/ia-config.components';
import { panel } from '../../shared/ui';
import {
  SETUP_ASSISTANT_CLEAR_ID,
  SETUP_CATEGORY_SELECT_ID,
  SETUP_CONFIG_KEY_SELECT_ID,
  SETUP_LANGUAGE_SELECT_ID,
  SETUP_LEVELS_CHANNEL_ID,
  SETUP_LEVELS_TOGGLE_ID,
  SETUP_LOGS_CAT_SELECT_ID,
  SETUP_LOGS_CHANNEL_ID,
  SETUP_MOD_CHANNEL_ID,
  SETUP_MOD_DERANK_ID,
  SETUP_MODULES_DISABLE_ID,
  SETUP_MODULES_ENABLE_ID,
  SETUP_MODULES_PICK_ID,
  SETUP_ROLES_ADD_ID,
  SETUP_ROLES_CHANNEL_ID,
  SETUP_ROLES_POST_ID,
  SETUP_ROLES_REFRESH_ID,
  SETUP_TICKETS_CATEGORY_ID,
  SETUP_TICKETS_LOGS_ID,
  SETUP_TICKETS_PANEL_ID,
  SETUP_TICKETS_POST_ID,
  SETUP_TICKETS_STAFF_ID,
  SETUP_WELCOME_AUTOROLE_ID,
  SETUP_WELCOME_CHANNEL_ID,
  SETUP_WELCOME_DELETELEAVE_ID,
  SETUP_WELCOME_TOGGLE_ID,
  SETUP_BACK_ID,
} from './setup.components';

export type CategoryId =
  | 'modules'
  | 'welcome'
  | 'logs'
  | 'tickets'
  | 'roles'
  | 'levels'
  | 'moderation'
  | 'config'
  | 'agent'
  | 'language';

export const CATEGORY_IDS: CategoryId[] = [
  'modules',
  'welcome',
  'logs',
  'tickets',
  'roles',
  'levels',
  'moderation',
  'config',
  'agent',
  'language',
];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  modules: '🧩 Modules',
  welcome: '👋 Bienvenue & Départs',
  logs: '📜 Logs',
  tickets: '📬 Tickets',
  roles: '🎭 Rôles-réactions',
  levels: '🏆 Levels',
  moderation: '⚖️ Modération',
  config: '⚙️ Config avancée',
  agent: '🤖 Agent IA',
  language: '🌐 Langue du serveur',
};

export type DashboardRow = ActionRowBuilder<
  StringSelectMenuBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | ButtonBuilder
>;

const ch = (id: string, placeholder: string): ChannelSelectMenuBuilder =>
  new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder);

const role = (id: string, placeholder: string): RoleSelectMenuBuilder =>
  new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder);

const btn = (id: string, label: string, style: ButtonStyle): ButtonBuilder =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

const backRow = (): DashboardRow =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(btn(SETUP_BACK_ID, '⬅ Retour au menu', ButtonStyle.Secondary));

export function buildCategorySelect(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SETUP_CATEGORY_SELECT_ID)
      .setPlaceholder('Choisis une catégorie à configurer')
      .addOptions(
        CATEGORY_IDS.map((id) => ({
          label: CATEGORY_LABELS[id],
          value: id,
        })),
      ),
  );
}

/** Panneau principal : vue d'ensemble + sélecteur de catégorie. */
export function renderMainPanel(config: GuildConfig, ia: LlmStatus, pixellab: boolean): ContainerBuilder {
  const iaLine =
    ia.source === 'none'
      ? '**IA** : ❌ non connectée (owner : catégorie Agent IA)'
      : `**IA** : ✅ ${ia.provider} / \`${ia.model}\``;
  const modulesOn = MODULE_CATALOG.filter(
    (m) => config.assistant.channelId !== undefined,
  ).length;
  return panel({
    title: '## 🎛️ Panneau de contrôle 10cordes',
    lines: [
      iaLine,
      `**PixelLab** : ${pixellab ? '✅ connecté' : '❌ clé absente (catégorie Agent IA)'}`,
      `**Langue serveur** : ${config.defaultLocale} · **Bienvenue** : ${config.welcome.enabled ? 'on' : 'off'} · **Levels** : ${config.levels.enabled ? 'on' : 'off'}`,
      '**Modules actifs** : ' + MODULE_CATALOG.map((m) => m.id).join(', '),
      `*${modulesOn} modules enregistrés, tout est aussi configurable en langage naturel en mentionnant le bot.*`,
    ],
    footer: 'Sélectionne une catégorie ci-dessous pour la configurer.',
  });
}

/** Panneau d'une catégorie : état courant + contrôles. */
export function renderCategoryPanel(
  category: CategoryId,
  config: GuildConfig,
  ia: LlmStatus,
  pixellab: boolean,
  pending?: string,
): { container: ContainerBuilder; rows: DashboardRow[] } {
  const rows: DashboardRow[] = [];

  const container = panel({ title: CATEGORY_LABELS[category], lines: [], footer: 'Les changements sont immédiats.' });

  switch (category) {
    case 'modules': {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(SETUP_MODULES_PICK_ID)
            .setPlaceholder(pending ? `Module sélectionné : ${pending}` : 'Choisis un module')
            .addOptions(
              MODULE_CATALOG.map((m) => ({ label: m.label, value: m.id, description: m.description.slice(0, 99) })),
            ),
        ),
      );
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn(SETUP_MODULES_ENABLE_ID, '✅ Activer', ButtonStyle.Success),
          btn(SETUP_MODULES_DISABLE_ID, '🚫 Désactiver', ButtonStyle.Danger),
        ),
      );
      break;
    }
    case 'welcome': {
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_WELCOME_CHANNEL_ID, 'Salon de bienvenue')));
      rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(role(SETUP_WELCOME_AUTOROLE_ID, 'Auto-rôle à l\'arrivée')));
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn(SETUP_WELCOME_TOGGLE_ID, config.welcome.enabled ? '👋 Welcome : ON' : '👋 Welcome : OFF', ButtonStyle.Primary),
          btn(SETUP_WELCOME_DELETELEAVE_ID, config.welcome.deleteOnLeave ? '🧹 Delete on leave : ON' : '🧹 Delete on leave : OFF', ButtonStyle.Secondary),
        ),
      );
      break;
    }
    case 'logs': {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(SETUP_LOGS_CAT_SELECT_ID)
            .setPlaceholder(pending ? `Catégorie choisie : ${pending}, prends le salon` : '1. Choisis la catégorie de logs')
            .addOptions(
              ['messages', 'members', 'voice', 'moderation', 'server'].map((c) => ({ label: c, value: c })),
            ),
        ),
      );
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_LOGS_CHANNEL_ID, '2. Salon recevant ces logs')));
      break;
    }
    case 'tickets': {
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_TICKETS_CATEGORY_ID, 'Catégorie des tickets')));
      rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(role(SETUP_TICKETS_STAFF_ID, 'Rôle staff')));
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_TICKETS_PANEL_ID, 'Salon du panneau')));
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_TICKETS_LOGS_ID, 'Salon des transcripts')));
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(btn(SETUP_TICKETS_POST_ID, '📬 Poster le panneau', ButtonStyle.Primary)));
      break;
    }
    case 'roles': {
      rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(role(SETUP_ROLES_ADD_ID, 'Rôles proposés dans le menu')));
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_ROLES_CHANNEL_ID, 'Salon du menu de rôles')));
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn(SETUP_ROLES_POST_ID, '📬 Poster', ButtonStyle.Primary),
          btn(SETUP_ROLES_REFRESH_ID, '🔄 Rafraîchir', ButtonStyle.Secondary),
        ),
      );
      break;
    }
    case 'levels': {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn(SETUP_LEVELS_TOGGLE_ID, config.levels.enabled ? '🏆 Levels : ON' : '🏆 Levels : OFF', ButtonStyle.Primary),
        ),
      );
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_LEVELS_CHANNEL_ID, 'Salon des level-ups (vide = canal courant)')));
      break;
    }
    case 'moderation': {
      rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ch(SETUP_MOD_CHANNEL_ID, 'Salon réservé aux sanctions')));
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          btn(SETUP_MOD_DERANK_ID, config.moderation.muteDerank ? '⚖️ Mute derank : ON' : '⚖️ Mute derank : OFF', ButtonStyle.Primary),
        ),
      );
      break;
    }
    case 'config': {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(SETUP_CONFIG_KEY_SELECT_ID)
            .setPlaceholder('Choisis une clé de configuration')
            .addOptions(CONFIG_KEYS.slice(0, 25).map((key) => ({ label: key.path, value: key.path, description: key.description.slice(0, 99) }))),
        ),
      );
      break;
    }
    case 'agent': {
      container.components.splice(0);
      const agentPanel = panel({
        title: CATEGORY_LABELS.agent,
        lines: [
          ia.source === 'none'
            ? '**IA** : ❌ non connectée, clique le bouton ci-dessous (owner).'
            : `**IA** : ✅ ${ia.provider} / \`${ia.model}\` (clé ${ia.maskedKey}) : ${ia.baseUrl}`,
          `**PixelLab** : ${pixellab ? '✅ connecté' : '❌ clé absente (champ optionnel de la modale)'}`,
          'L\'agent est aussi joignable en langage naturel : mentionne le bot, parle dans le salon dédié IA, ou réponds à ses messages.',
        ],
        footer: 'La modale teste la connexion en direct, effet immédiat.',
      });
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(btn(IA_CONFIG_BUTTON_ID, "🔑 Connecter l'IA", ButtonStyle.Primary)));
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(btn(SETUP_ASSISTANT_CLEAR_ID, '🌐 Utiliser le salon dédié IA', ButtonStyle.Secondary)));
      return { container: agentPanel, rows };
    }
    case 'language': {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(SETUP_LANGUAGE_SELECT_ID)
            .setPlaceholder(`Langue par défaut : ${config.defaultLocale}`)
            .addOptions(
              { label: 'Français', value: 'fr' },
              { label: 'English', value: 'en' },
            ),
        ),
      );
      break;
    }
  }

  rows.push(backRow());
  return { container, rows };
}
