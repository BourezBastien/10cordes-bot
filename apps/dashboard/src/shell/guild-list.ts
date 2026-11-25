import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { GuildListSchema, type GuildSummary } from '@/lib/schemas';

/*
 * ACCÈS AUX SERVEURS. La liste des serveurs où le compte connecté peut
 * configurer le bot : la barre haute (sélecteur), la palette, la page des
 * serveurs. Les chemins de l'API se construisent ici, et nulle part ailleurs.
 */

const GUILDS_PATH = '/api/v1/guilds';

/** Chemin d'une route d'un serveur. */
export function guildPath(guildId: string, suffix = ''): string {
  return `${GUILDS_PATH}/${encodeURIComponent(guildId)}${suffix}`;
}

export function useGuildList(enabled = true) {
  return useQuery({
    queryKey: ['guilds'],
    queryFn: () => api.get(GUILDS_PATH, GuildListSchema),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function guildOptions(guilds: ReadonlyArray<GuildSummary>) {
  return guilds.map((guild) => ({ value: guild.id, label: guild.name, guild }));
}
