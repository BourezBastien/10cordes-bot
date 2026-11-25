import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import { permissionNamesPolicy } from '../../core/security/permission-names.policy';
import { CorrectionRefusedError } from './memory-correction.errors';
import { FACT_MAX } from './memory-correction.matcher';
import type { CorrectionOutcome, MemoryCorrectionService } from './memory-correction.service';

/*
 * Outil `memory.correct` : corriger un fait mémorisé sur un membre ou sur le
 * serveur. À appeler quand un membre CORRIGE ce que l'agent retient, à la
 * place d'un ajout, qui laisserait l'ancien fait en place.
 *
 * Le nom de l'outil reste un littéral de chaîne posé sur la clé name : c'est
 * ce que lit `sync-tool-names.mjs` pour tenir le registre des outils.
 */

export const MEMORY_CORRECT_TOOL = { name: 'memory.correct', category: 'memory' } as const;

const GUILD_REQUIRED = 'Contexte de serveur requis.';
const MANAGE_REQUIRED = 'Corriger la mémoire d\u0027un autre membre ou celle du serveur requiert ManageGuild.';
const SUMMARY_FACT_MAX = 120;

/** Ce que l'outil dit d'une correction retenue. */
export function correctionSummary(outcome: CorrectionOutcome, target: string): string {
  const what = `« ${outcome.entry.newFact.slice(0, SUMMARY_FACT_MAX)} » remplace « ${outcome.entry.oldFact.slice(0, SUMMARY_FACT_MAX)} »`;
  const journal = outcome.supersededEntries > 0 ? ` ${outcome.supersededEntries} entrée(s) périmée(s) dans le journal.` : '';
  const sheet =
    outcome.consolidation.status === 'appended'
      ? ' Fiche consolidée mise à jour.'
      : outcome.consolidation.status === 'rejected'
        ? ` Le conservateur n'a pas réécrit la fiche (${outcome.consolidation.reason ?? 'fait non retenu'}) : la correction prime quand même.`
        : ' La fiche sera réécrite à la prochaine fusion : la correction prime dès maintenant.';
  return `Mémoire corrigée (${target}) : ${what}.${journal}${sheet}`;
}

export function buildMemoryCorrectionTool(deps: { readonly corrections: Pick<MemoryCorrectionService, 'record'> }): BotTool {
  return {
    ...MEMORY_CORRECT_TOOL,
    description:
      'Corrige un fait mémorisé sur un membre ou sur le serveur : l\u0027ancien fait est retiré de ce que tu lis, et le nouveau prime sur toute la mémoire.',
    keywords: ['mémoire', 'correction', 'corriger', 'faux', 'n\u0027est plus vrai', 'ne vit plus', 'a déménagé', 'a changé', 'en fait'],
    paramsSchema: z.object({
      oldFact: z.string().min(3).max(FACT_MAX.old).describe('Le fait mémorisé qui est faux ou périmé, en une phrase courte (ex. : « habite à Lille »)'),
      newFact: z.string().min(3).max(FACT_MAX.new).describe('Le fait qui le remplace'),
      userId: z.string().min(15).optional().describe('Membre concerné ; absent : le demandeur lui-même'),
      scope: z.enum(['member', 'server']).default('member').describe('member (défaut) : un membre ; server : le serveur entier'),
    }),
    requiredModules: [],
    permissions: [],
    destructive: false,
    systemPrompt:
      'À appeler quand un membre CORRIGE un fait mémorisé (« en fait je n\u0027habite plus à Lille », « ce n\u0027est plus vrai », « j\u0027ai changé de prénom ») : JAMAIS un simple ajout, qui laisserait l\u0027ancien fait. Par défaut sur le demandeur lui-même ; corriger un autre membre, ou le serveur entier, exige ManageGuild. Confirme en une phrase.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
      const { oldFact, newFact, userId, scope } = input as { oldFact: string; newFact: string; userId?: string; scope?: 'member' | 'server' };
      const onServer = scope === 'server';
      const memberId = onServer ? null : (userId ?? ctx.userId);
      if ((onServer || memberId !== ctx.userId) && !permissionNamesPolicy.hasAny(ctx.permissions, ['ManageGuild', 'Administrator'])) {
        return { ok: false, summary: MANAGE_REQUIRED };
      }
      try {
        const outcome = await deps.corrections.record({ guildId: ctx.guildId, userId: memberId, oldFact, newFact, actorId: ctx.userId });
        return { ok: true, summary: correctionSummary(outcome, memberId === null ? 'serveur' : `<@${memberId}>`) };
      } catch (error) {
        // Un refus du contrat est un résultat ; tout autre échec remonte au registre.
        if (error instanceof CorrectionRefusedError) return { ok: false, summary: error.message };
        throw error;
      }
    },
  };
}
