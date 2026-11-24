import type { PlanAction } from '../../core/security/action-plan.policy';
import { fileLog } from '../logging/file-log.service';
import { getLlm } from '../assistant/llm.accessor';
import { describeError } from '../../shared/utils/error-stack';
import { describeAction } from './action-plan.presenter';
import { PLAN_LIMITS, type PlanRequest } from './action-plan.types';

/** Le résumé ne doit pas retenir la réponse : au-delà, le panneau s'affiche sans lui. */
const SUMMARY_TIMEOUT_MS = 12_000;
/** Part de la demande transmise au modèle : de quoi nommer l'intention, pas tout le fil. */
const REQUEST_MAX = 600;
/** Cause de l'appel dans le journal des coûts (`logs/llm.jsonl`). */
const SUMMARY_CAUSE = 'plan.summary';

const INSTRUCTIONS = [
  'Tu rédiges le résumé d\u0027un plan d\u0027action qu\u0027un assistant de serveur Discord propose à un membre : il lira ce résumé avant de cliquer sur « Appliquer ».',
  'Écris en une ou deux phrases, à la deuxième personne, ce que les actions feront concrètement. Rien d\u0027autre : aucune promesse, aucune action de plus, aucune question, aucun conseil.',
  'Interdit : mentionner qui que ce soit (@), les liens, le code, les listes, les titres.',
  'Réponds dans la langue de la demande du membre, avec le résumé seul.',
].join('\n');

/**
 * Nettoie un résumé écrit par le modèle : il est affiché, jamais exécuté.
 * Mention, lien, bloc de code et balise sont retirés (le texte du modèle ne
 * peut ni prévenir quelqu\u0027un ni l\u0027envoyer ailleurs), les blancs sont
 * resserrés, la longueur est plafonnée. Vide quand il ne reste rien.
 */
export function cleanPlanSummary(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, ' ')
    // Mentions, salons, émojis personnalisés et balises Discord : d'une accolade à l'autre.
    .replace(/<[^<>\n]*>/gu, ' ')
    // Tout mot précédé d'un arobase (@everyone, @here, un pseudonyme).
    .replace(/(^|\s)@[^\s,;:.!?)]+/gu, '$1')
    .replace(/\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gu, ' ')
    .replace(/[<>`*_#|~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, PLAN_LIMITS.summaryMax)
    .trimEnd();
}

/**
 * Résumé d'un plan, écrit par le modèle quand le panneau se forme. Il aide
 * le demandeur à décider ; il ne pilote rien : les actions exécutées au clic
 * sont celles du plan, jamais ce que le résumé raconte.
 */
export class PlanSummaryWriter {
  /**
   * Le résumé, ou null si le modèle ne répond pas à temps ou ne répond pas
   * en texte : le panneau s'affiche sans. L'appel est un appel LLM comme un
   * autre : il entre dans le journal des coûts (cause `plan.summary`).
   */
  async write(input: { guildId: string; userId: string; request: PlanRequest; actions: readonly PlanAction[] }): Promise<string | null> {
    if (input.actions.length === 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    try {
      const listing = input.actions.map((action, index) => `${index + 1}. ${action.tool}(${describeAction(action)})`).join('\n');
      const asked = input.request.content ? `« ${input.request.content.slice(0, REQUEST_MAX)} »` : '(non transmise)';
      const completion = await Promise.race([
        getLlm().chatStream(
          [
            { role: 'system', content: INSTRUCTIONS },
            { role: 'user', content: `Demande du membre : ${asked}\n\nActions proposées :\n${listing}` },
          ],
          [],
          { userId: input.userId, guildId: input.guildId, cause: 'reply', reasoningEffort: null, preferReasoning: false },
          {},
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('délai du résumé dépassé')), SUMMARY_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      fileLog()?.llm({
        cause: SUMMARY_CAUSE,
        model: completion.served?.model ?? 'runtime',
        provider: completion.served?.provider,
        fallback: completion.served?.fallback,
        capability: completion.served?.capability,
        promptTokens: completion.usage?.promptTokens ?? 0,
        completionTokens: completion.usage?.completionTokens ?? 0,
        ms: Date.now() - startedAt,
        ok: completion.toolCalls.length === 0,
        guildId: input.guildId,
      });
      if (completion.toolCalls.length > 0) return null;
      return cleanPlanSummary(completion.content ?? '') || null;
    } catch (error) {
      fileLog()?.llm({ cause: SUMMARY_CAUSE, model: 'runtime', promptTokens: 0, completionTokens: 0, ms: Date.now() - startedAt, ok: false, error: describeError(error), guildId: input.guildId });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
