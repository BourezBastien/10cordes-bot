import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { GuildRulesPatchSchema, GuildRulesSchema, type GuildRules, type GuildRulesPatch } from '@10cordes/shared';
import { guildPath } from '@/shell/guild-list';
import { api } from '@/lib/api';

/*
 * RÈGLES DU SERVEUR : lecture et enregistrement. Un enregistrement n'envoie
 * que ce qui a changé ; les consignes vont par ajout et retrait (jamais par
 * remplacement de la liste entière). Une règle changée depuis Discord (flux
 * temps réel, `rules.updated`) relit la page.
 */

export function useRules(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'rules'],
    queryFn: () => api.get(guildPath(guildId, '/rules'), GuildRulesSchema),
  });
}

export function useSaveRules(guildId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: GuildRulesPatch) =>
      api.patch(guildPath(guildId, '/rules'), GuildRulesPatchSchema.parse(patch), z.object({ rules: GuildRulesSchema })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'rules'] }),
        queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'home'] }),
      ]),
  });
}

const LIST_KEYS = ['freeCategoryIds', 'freeChannelIds', 'blockedChannelIds'] as const;
const FLAG_KEYS = ['strictMentionElsewhere', 'seriousOnlyElsewhere', 'confirmDestructiveActions'] as const;

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * Ce qu'il faut envoyer pour passer de `base` à `draft`, rien d'autre ;
 * null s'il n'y a rien à changer. Les listes de salons partent triées (leur
 * ordre ne signifie rien), les consignes par ajout et retrait.
 */
export function buildPatch(
  base: GuildRules,
  draft: GuildRules,
  added: ReadonlyArray<string>,
  removed: ReadonlyArray<string>,
): GuildRulesPatch | null {
  const patch: Record<string, unknown> = {};
  for (const key of LIST_KEYS) {
    if (!sameSet(base[key], draft[key])) patch[key] = [...draft[key]].sort();
  }
  for (const key of FLAG_KEYS) {
    if (base[key] !== draft[key]) patch[key] = draft[key];
  }
  if (added.length > 0) patch.addCustomInstructions = [...added];
  if (removed.length > 0) patch.removeCustomInstructions = [...removed];
  return Object.keys(patch).length > 0 ? (patch as GuildRulesPatch) : null;
}

/** Nombre de groupes de règles qui diffèrent entre deux états. */
export function countChanges(base: GuildRules, draft: GuildRules, added: ReadonlyArray<string>, removed: ReadonlyArray<string>): number {
  const lists = LIST_KEYS.filter((key) => !sameSet(base[key], draft[key])).length;
  const flags = FLAG_KEYS.filter((key) => base[key] !== draft[key]).length;
  return lists + flags + (added.length > 0 || removed.length > 0 ? 1 : 0);
}
