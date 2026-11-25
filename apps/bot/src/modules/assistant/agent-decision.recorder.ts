import type { RequestIntent } from './request-intent';
import { describeError } from '../../shared/utils/error-stack';

/*
 * ENREGISTREUR D'UNE DÉCISION. Ce que l'agent retient d'une demande, pour
 * répondre plus tard à « pourquoi as-tu fait ça ? » : qui l'a émise, ce qui l'a
 * fait classer action ou conversation (le motif), si le raisonnement a été
 * demandé, combien de tours, et les étapes reçues de `ctx.progress` (ce qu'un
 * tool long raconte) comme les résultats des tools.
 *
 * Aucun contenu de message n'est retenu. Tout est borné : les textes sont
 * coupés, les étapes au-delà de la borne sont comptées et non écrites. La
 * classe est pure : elle produit la ligne, le journal l'écrit.
 */

export type DecisionSource = 'discord' | 'web';
export type DecisionOutcome = 'replied' | 'silent' | 'cached' | 'failed' | 'ceiling' | 'quota';

/** Étapes gardées par demande : au-delà, les suivantes sont comptées et non écrites. */
export const DECISION_STEPS_MAX = 60;
const TEXT_MAX = 200;
const NAME_MAX = 80;
const MOTIF_MAX = 120;
const ERROR_MAX = 300;

export interface DecisionStep {
  /** Millisecondes depuis l'ouverture de la décision. */
  at: number;
  kind: 'progress' | 'tool';
  name?: string;
  text: string;
  ok?: boolean;
}

export interface DecisionStart {
  guildId: string;
  requestId: string;
  source: DecisionSource;
  actorId: string;
  channelId: string | null;
}

/** La ligne d'une décision, telle que le journal l'écrit. */
export interface DecisionRow {
  requestId: string;
  source: DecisionSource;
  actorId: string;
  channelId: string | null;
  intent: 'action' | 'conversation';
  signal: string | null;
  motif: string | null;
  reasoning: boolean;
  effort: string | null;
  turns: number;
  tools: number;
  failures: number;
  outcome: DecisionOutcome;
  stepsJson: string | null;
  error: string | null;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

/** Ce qu'une boucle rend, réduit à ce qui décide l'issue. */
export interface DecisionResult {
  finalText: string | null;
  error: Error | null;
  quotaExhausted?: boolean;
  forcedSummary?: boolean;
}

/** L'issue d'une demande selon ce que la boucle a rendu. */
export function outcomeOf(result: DecisionResult): DecisionOutcome {
  if (result.error) return result.quotaExhausted ? 'quota' : 'failed';
  if (result.forcedSummary) return 'ceiling';
  return result.finalText === null ? 'silent' : 'replied';
}

/** L'intention et son motif : le signal qui a fait classer la demande en action, et ce qu'il a nommé. */
export function motifOf(intent: RequestIntent): { intent: 'action' | 'conversation'; signal: string | null; motif: string | null } {
  if (!intent.signal) return { intent: 'conversation', signal: null, motif: null };
  const named = intent.signal === 'skill' ? intent.matchedSkills[0]?.split(' | ')[0] : intent.signal === 'tool' ? intent.mutatingTools[0] : null;
  return { intent: 'action', signal: intent.signal, motif: (named ? `${intent.signal}:${named}` : intent.signal).slice(0, MOTIF_MAX) };
}

const clip = (text: string, max: number): string => text.slice(0, max);

/** Ce qu'une décision garde d'un parcours, hors le commencement et le décompte des étapes. */
interface DecisionFacts {
  intent: DecisionRow['intent'];
  signal: string | null;
  motif: string | null;
  reasoning: boolean;
  effort: string | null;
  turns: number;
  usage: { promptTokens: number; completionTokens: number };
  outcome: DecisionOutcome;
  error: string | null;
}

export class AgentDecisionRecorder {
  private readonly startedAt = Date.now();
  private readonly steps: DecisionStep[] = [];
  private tools = 0;
  private failures = 0;
  private overflow = 0;

  constructor(readonly start: DecisionStart) {}

  /** Une ligne de progression reçue de `ctx.progress` (un tool long qui raconte). */
  readonly note = (text: unknown): void => {
    this.push({ kind: 'progress', text: clip(String(text ?? ''), TEXT_MAX) });
  };

  /** Le résultat d'un tool exécuté. */
  readonly step = (name: string, result: { ok: boolean; summary: string }): void => {
    this.tools += 1;
    if (!result.ok) this.failures += 1;
    this.push({ kind: 'tool', name: clip(name, NAME_MAX), text: clip(result.summary ?? '', TEXT_MAX), ok: result.ok });
  };

  /** La demande a été servie par le cache : aucune boucle, aucun tour. */
  cached(intent: RequestIntent): DecisionRow {
    return this.row({ ...motifOf(intent), reasoning: false, effort: null, turns: 0, usage: { promptTokens: 0, completionTokens: 0 }, outcome: 'cached', error: null });
  }

  finish(input: { intent: RequestIntent; reasoning: boolean; effort: string | null; turns: number; usage: { promptTokens: number; completionTokens: number }; outcome: DecisionOutcome; error?: unknown }): DecisionRow {
    const error = input.error === undefined || input.error === null ? null : clip(describeError(input.error), ERROR_MAX);
    return this.row({ ...motifOf(input.intent), reasoning: input.reasoning, effort: input.effort, turns: input.turns, usage: input.usage, outcome: input.outcome, error });
  }

  /** La ligne de la décision : le commencement, le décompte des étapes, et ce que le parcours en a gardé. */
  private row(facts: DecisionFacts): DecisionRow {
    const { usage, ...rest } = facts;
    const steps = this.overflow > 0 ? [...this.steps, { at: Date.now() - this.startedAt, kind: 'progress' as const, text: `(+${this.overflow} autres étapes)` }] : this.steps;
    return {
      requestId: this.start.requestId,
      source: this.start.source,
      actorId: this.start.actorId,
      channelId: this.start.channelId,
      tools: this.tools,
      failures: this.failures,
      stepsJson: steps.length > 0 ? JSON.stringify(steps) : null,
      durationMs: Date.now() - this.startedAt,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      ...rest,
    };
  }

  private push(step: Omit<DecisionStep, 'at'>): void {
    if (this.steps.length >= DECISION_STEPS_MAX) {
      this.overflow += 1;
      return;
    }
    this.steps.push({ ...step, at: Date.now() - this.startedAt });
  }
}
