import { BadRequestError, TooManyRequestsError, ValidationError, type HttpError } from '@spraxium/http';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { REQUEST_ID_PATTERN } from '../assistant/request-progress.service';

/**
 * Ce dont le contrôleur des serveurs a besoin à côté de ses services : les
 * schémas de ses corps de requête, le filtre du journal d'audit et la
 * traduction des refus du chat web. Tout y est pur.
 */

/** Patch de la configuration : un objet libre (le service revalide tout le document). */
export const ConfigPatchSchema = z.looseObject({});
export type ConfigPatch = z.output<typeof ConfigPatchSchema>;

/** Bascule d'un module : `confirm` valide la cascade de désactivation que le dashboard vient de montrer. */
export const ModuleToggleSchema = z.object({
  enabled: z.boolean(),
  confirm: z.boolean().optional(),
});
export type ModuleToggle = z.output<typeof ModuleToggleSchema>;

/**
 * Message du chat de l'agent : ni vide, ni au-delà de ce qu'accepte le service
 * (2 000 caractères). `requestId` est l'identifiant que le panel choisit pour
 * suivre les étapes de sa demande pendant qu'elle tourne.
 */
export const AgentChatSchema = z.object({
  message: z.string().trim().min(1, 'Le message ne peut pas être vide.').max(2000, 'Le message dépasse 2 000 caractères.'),
  requestId: z
    .string()
    .trim()
    .regex(new RegExp(REQUEST_ID_PATTERN, 'u'), 'Identifiant de demande attendu : « web- », puis lettres, chiffres ou tirets (8 à 36).')
    .optional(),
});
export type AgentChat = z.output<typeof AgentChatSchema>;

/** Familles du journal d'audit proposées au dashboard ; `all` demande le journal entier, comme l'absence du paramètre. */
export const AUDIT_KINDS = ['all', 'actions', 'plans', 'errors'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];
const ALL: AuditKind = 'all';

const PLAN_PREFIX = 'plan.';
const DENIED_TOOL_PREFIX = 'tool.denied.';
/** Les plans d'action : `plan.posted`, `plan.applied`... */
const PLAN_FILTERS: Prisma.AuditLogWhereInput[] = [{ action: { startsWith: PLAN_PREFIX } }];
/** Les échecs et refus : erreur de l'agent, outil refusé (`tool.denied.*`), confirmation refusée. */
const ERROR_FILTERS: Prisma.AuditLogWhereInput[] = [
  { action: 'assistant.error' },
  { action: { startsWith: DENIED_TOOL_PREFIX } },
  { action: 'rule.confirm.denied' },
];

/** La famille demandée (`kind`), null pour le journal entier ; une famille inconnue est refusée (400). */
export function auditKindOf(raw: string | undefined): AuditKind | null {
  if (raw === undefined || raw === '' || raw === ALL) return null;
  const kind = AUDIT_KINDS.find((entry) => entry === raw);
  if (!kind) throw new ValidationError([{ property: 'kind', constraints: { message: `Famille inconnue : attendue l\u0027une de ${AUDIT_KINDS.join(', ')}.` } }]);
  return kind;
}

/** Au-delà, une page demandée est ramenée à la dernière : un nombre démesuré ne doit pas atteindre la base. */
const MAX_AUDIT_PAGE = 10_000;

/** Page demandée (`page`), à partir de 1 : absente, nulle ou mal formée, c'est la première. */
export function auditPageOf(raw: string | undefined): number {
  return Math.min(Math.max(1, Number.parseInt(raw ?? '1', 10) || 1), MAX_AUDIT_PAGE);
}

/**
 * Filtre Prisma du journal d'un serveur, par famille. `actions` est tout, sauf
 * les plans et les erreurs ; `plans` commence par `plan.` ; `errors` réunit
 * l'erreur de l'agent, les outils refusés et la confirmation refusée.
 */
export function auditWhere(guildId: string, kind: AuditKind | null): Prisma.AuditLogWhereInput {
  if (kind === 'plans') return { guildId, OR: PLAN_FILTERS };
  if (kind === 'errors') return { guildId, OR: ERROR_FILTERS };
  if (kind === 'actions') return { guildId, NOT: { OR: [...PLAN_FILTERS, ...ERROR_FILTERS] } };
  return { guildId };
}

const RATE_LIMITED = 'Trop de demandes';

/**
 * Refus de `WebAgentService` : il les lance en `Error` simples, dont le message
 * est la phrase à montrer. La limite de cadence est seule à répondre 429.
 * Null pour ce qui n'en est pas un (bug, panne) : l'erreur remonte telle quelle.
 */
export function webAgentRefusal(error: unknown): HttpError | null {
  if (!(error instanceof Error) || error.message.length === 0 || error.message.length >= 200) return null;
  return error.message.startsWith(RATE_LIMITED) ? new TooManyRequestsError(error.message) : new BadRequestError(error.message);
}
