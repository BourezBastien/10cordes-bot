import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { guildPath } from '@/shell/guild-list';
import { api } from './api';

/*
 * ÉTAPES D'UNE DEMANDE DE L'AGENT. Le panneau choisit l'identifiant de la
 * demande, l'envoie avec son message, puis interroge toutes les 1,5 s ce que
 * le bot en a fait : les outils appelés, réussis ou non. Tant que la route
 * n'existe pas (404), la lecture s'arrête et la page montre seulement que la
 * demande est en cours : rien n'est inventé.
 */

export const RequestStepSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  summary: z.string(),
});

export const RequestProgressSchema = z.object({
  requestId: z.string(),
  state: z.enum(['running', 'done', 'failed']),
  steps: z.array(RequestStepSchema),
});
export type RequestProgress = z.infer<typeof RequestProgressSchema>;
export type RequestStep = z.infer<typeof RequestStepSchema>;

/** Un identifiant de demande choisi par le panneau, pour suivre ses étapes. */
export function newRequestId(): string {
  const unique =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `web-${unique}`;
}

export function useRequestProgress(guildId: string, requestId: string | null, active: boolean) {
  return useQuery({
    queryKey: ['guild', guildId, 'request', requestId],
    queryFn: () => api.get(guildPath(guildId, `/agent/requests/${encodeURIComponent(requestId ?? '')}`), RequestProgressSchema),
    enabled: active && Boolean(requestId),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      return query.state.data && query.state.data.state !== 'running' ? false : active ? 1500 : false;
    },
  });
}
