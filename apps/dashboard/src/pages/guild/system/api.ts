import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AgentSettingsSchema,
  UsageSummarySchema,
  type AgentSettingsPatch,
  type ThinkingMode,
  type UsageWindow,
} from '@10cordes/shared';
import { guildPath } from '@/shell/guild-list';
import { api } from '@/lib/api';

/*
 * LECTURES DE LA PAGE SYSTÈME : la consommation d'une fenêtre (24 h, 7 j,
 * 30 j) et le réglage de réflexion de l'agent. Un changement de règle ou de
 * route (flux temps réel) relit l'accueil, pas ces lectures.
 */

export function useUsage(guildId: string, window: UsageWindow) {
  return useQuery({
    queryKey: ['guild', guildId, 'usage', window],
    queryFn: () => api.get(guildPath(guildId, `/usage?window=${window}`), UsageSummarySchema),
    staleTime: 60_000,
  });
}

export function useAgentSettings(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'agent-settings'],
    queryFn: () => api.get(guildPath(guildId, '/agent-settings'), AgentSettingsSchema),
  });
}

export function useSaveThinkingMode(guildId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (thinkingMode: ThinkingMode) =>
      api.patch(guildPath(guildId, '/agent-settings'), { thinkingMode } satisfies AgentSettingsPatch, z.object({ settings: AgentSettingsSchema })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'agent-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'home'] });
    },
  });
}
