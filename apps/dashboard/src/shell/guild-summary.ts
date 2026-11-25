import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { GuildDetailSchema } from '@/lib/schemas';
import { guildPath } from './guild-list';

/** Fiche du serveur affiché (nom, icône, membres), partagée avec la coque de la page. */
export function useGuildSummary(guildId: string | null) {
  return useQuery({
    queryKey: ['guild', guildId, 'summary'],
    queryFn: () => api.get(guildPath(guildId ?? ''), GuildDetailSchema),
    enabled: Boolean(guildId),
    // Un refus (403) ou un serveur inconnu (404) ne se retente pas : la page le dit.
    retry: (count, error) => !(error instanceof ApiError && (error.status === 403 || error.status === 404)) && count < 1,
  });
}
