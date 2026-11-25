import { useQuery } from '@tanstack/react-query';
import { guildPath } from '@/shell/guild-list';
import { api } from './api';
import {
  AuditPageSchema,
  ChannelListSchema,
  ConfigDocumentSchema,
  MemoriesSchema,
  ModuleListSchema,
  RoleListSchema,
  StatsSchema,
} from './schemas';

/*
 * LECTURES D'UN SERVEUR (routes existantes de l'API). Toute clé commence
 * par ['guild', guildId, portée] : un événement temps réel invalide la
 * portée qu'il concerne (lib/events.ts, EVENT_SCOPES). Les salons et rôles
 * changent rarement : cinq minutes de fraîcheur.
 */

const SLOW = 5 * 60_000;

export function useChannels(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'channels'],
    queryFn: () => api.get(guildPath(guildId, '/channels'), ChannelListSchema),
    staleTime: SLOW,
  });
}

export function useRoles(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'roles'],
    queryFn: () => api.get(guildPath(guildId, '/roles'), RoleListSchema),
    staleTime: SLOW,
  });
}

export function useConfig(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'config'],
    queryFn: () => api.get(guildPath(guildId, '/config'), ConfigDocumentSchema),
  });
}

export function useModules(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'modules'],
    queryFn: () => api.get(guildPath(guildId, '/modules'), ModuleListSchema),
  });
}

export function useAuditPage(guildId: string, page: number, kind: JournalKind = 'all') {
  return useQuery({
    queryKey: ['guild', guildId, 'journal', kind, page],
    queryFn: () => api.get(guildPath(guildId, `/audit?page=${page}&kind=${kind}`), AuditPageSchema),
    // Le journal vit : une page déjà vue se relit au retour, et la première se rafraîchit d'elle-même.
    staleTime: 15_000,
    refetchInterval: kind === 'all' && page === 1 ? 20_000 : false,
  });
}

/** Filtre du journal : tout, les actions, les plans de confirmation, les erreurs. */
export type JournalKind = 'all' | 'actions' | 'plans' | 'errors';

export const JOURNAL_KINDS: ReadonlyArray<JournalKind> = ['all', 'actions', 'plans', 'errors'];

export function useMemories(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'memories'],
    queryFn: () => api.get(guildPath(guildId, '/memories'), MemoriesSchema),
  });
}

export function useStats(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'stats'],
    queryFn: () => api.get(guildPath(guildId, '/stats'), StatsSchema),
    staleTime: 60_000,
  });
}
