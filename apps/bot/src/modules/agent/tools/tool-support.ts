import { ChannelType, type CategoryChannel, type Collection, type Guild, type NonThreadGuildBasedChannel, type Role } from 'discord.js';
import type { ToolResult } from '@10cordes/shared';

/**
 * Guides et utilitaires des tools Discord : état avant mutation (pour le
 * retour arrière) et analyse du style du serveur.
 */

/** État avant mutation : joint au résultat (data.preState) et archivé dans l'audit pour permettre un retour arrière. */
export function withPreState(result: ToolResult, preState: Record<string, unknown>): ToolResult {
  return { ...result, data: { ...(result.data ?? {}), preState } };
}

/** Résumé des overwrites d'un salon (3 au plus, 3 flags chacun). */
function overwriteSummary(guild: Guild, channel: NonThreadGuildBasedChannel): Array<Record<string, unknown>> {
  const roleName = (id: string): string => (id === guild.id ? 'everyone' : (guild.roles.cache.get(id)?.name ?? id));
  return (
    channel.permissionOverwrites.cache
      .first(3)
      ?.map((overwrite) => ({
        role: roleName(overwrite.id),
        allow: overwrite.allow.toArray().slice(0, 3),
        deny: overwrite.deny.toArray().slice(0, 3),
      })) ?? []
  );
}

function describeChannel(guild: Guild, channel: NonThreadGuildBasedChannel): Record<string, unknown> {
  const isText = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
  return {
    name: channel.name,
    type:
      channel.type === ChannelType.GuildText
        ? 'texte'
        : channel.type === ChannelType.GuildVoice
          ? 'vocal'
          : channel.type === ChannelType.GuildAnnouncement
            ? 'annonces'
            : channel.type === ChannelType.GuildForum
              ? 'forum'
              : 'autre',
    connectes: channel.type === ChannelType.GuildVoice ? channel.members.size : undefined,
    topic: isText && channel.topic ? channel.topic.slice(0, 100) : undefined,
    permissions: overwriteSummary(guild, channel),
  };
}

/** Rôles non gérés par une intégration, hors `@everyone`. */
function unmanagedRoles(guild: Guild): Collection<string, Role> {
  return guild.roles.cache.filter((role) => !role.managed && role.id !== guild.id);
}

/**
 * Analyse le style du serveur pour l'imitation : catégories avec salons
 * enfants (noms, types, topics), permissions par salon, positions.
 * L'agent l'appelle AVANT toute création pour reproduire les conventions.
 */
export function buildServerStyleGuide(guild: Guild): ToolResult {
  const channels = guild.channels.cache;
  const byPosition = (a: { rawPosition: number }, b: { rawPosition: number }): number => a.rawPosition - b.rawPosition;
  const notThread = (channel: { isThread(): boolean }): boolean => !channel.isThread();

  const categories = channels
    .filter((channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory)
    .sort(byPosition)
    .first(12)
    .map((category) => ({
      categorie: category.name,
      position: category.rawPosition,
      permissions: overwriteSummary(guild, category),
      salons: channels
        .filter(
          (channel): channel is NonThreadGuildBasedChannel => channel.parentId === category.id && notThread(channel),
        )
        .sort(byPosition)
        .first(25)
        .map((channel) => describeChannel(guild, channel)),
    }));

  const rootChannels = channels
    .filter(
      (channel): channel is NonThreadGuildBasedChannel =>
        channel.parentId === null && channel.type !== ChannelType.GuildCategory && notThread(channel),
    )
    .sort(byPosition)
    .first(12)
    .map((channel) => describeChannel(guild, channel));

  const roles = unmanagedRoles(guild)
    .sort((a, b) => b.position - a.position)
    .first(15)
    .map((role) => role.name);

  return {
    ok: true,
    summary: `Style du serveur : ${categories.length} catégories, ${channels.size} salons, ${roles.length} rôles listés. Imite ces conventions.`,
    data: { categories, sansCategorie: rootChannels, roles },
  };
}
