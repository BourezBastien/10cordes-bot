/*
 * PAGES D'UN SERVEUR. Une seule table pour la barre haute, le menu mobile,
 * la palette de recherche et le routeur : `to` est un chemin du routeur
 * (paramètre $guildId), `tile` dit si la page a sa case dans la barre basse
 * mobile (quatre cases), `label` la clé de traduction.
 */

export const GUILD_HOME = '/guilds/$guildId' as const;

export const GUILD_PAGES = [
  { id: 'home', to: GUILD_HOME, label: 'nav.home', tile: true },
  { id: 'providers', to: '/guilds/$guildId/providers', label: 'nav.ai', tile: true },
  { id: 'integrations', to: '/guilds/$guildId/integrations', label: 'nav.integrations', tile: true },
  { id: 'journal', to: '/guilds/$guildId/journal', label: 'nav.journal', tile: true },
  { id: 'rules', to: '/guilds/$guildId/rules', label: 'nav.rules', tile: false },
  { id: 'modules', to: '/guilds/$guildId/modules', label: 'nav.modules', tile: false },
  { id: 'config', to: '/guilds/$guildId/config', label: 'nav.config', tile: false },
  { id: 'memories', to: '/guilds/$guildId/memories', label: 'nav.memories', tile: false },
  { id: 'system', to: '/guilds/$guildId/system', label: 'nav.system', tile: false },
  { id: 'agent', to: '/guilds/$guildId/agent', label: 'nav.agent', tile: false },
] as const;

export type GuildPage = (typeof GUILD_PAGES)[number];
export type GuildPageId = GuildPage['id'];

export const GUILD_TILES = GUILD_PAGES.filter((page) => page.tile);
