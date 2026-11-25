import type { WebhookPingResult } from '@10cordes/shared';
import type { Logger } from '@spraxium/logger';
import type { PrismaService } from '../database/prisma.service';
import type { WebhookEndpoint } from './webhook-endpoint.codec';
import { buildWebhookRequest, extractResponseValue } from './webhook-request.builder';
import { sendWebhookRequest } from './webhook-http';

/** Longueur gardée d'une erreur consignée, comme à la vue du contrat. */
const LAST_ERROR_MAX = 300;

/**
 * Exécution d'un connecteur HTTP sortant : gabarit de la requête, échange,
 * extraction, puis consignation du dernier statut sur la ligne. Le même
 * chemin sert l'essai (`ping`) et l'appel de l'outil (`webhook.call`).
 *
 * Un connecteur désactivé ne fait rien : aucun appel ne part et rien n'est
 * consigné. Le résultat rendu est celui du contrat (`WebhookPingResult`) : un
 * échec est un `ok: false` explicite avec sa raison, jamais une exception.
 * Collaborateur non injectable : instancié par WebhookEndpointService.
 */
export class WebhookExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly log: Logger,
  ) {}

  async run(endpoint: WebhookEndpoint, payload: Record<string, unknown>): Promise<WebhookPingResult> {
    const label = `Connecteur « ${endpoint.slug} »`;
    if (!endpoint.enabled) {
      return { ok: false, status: null, summary: `${label} désactivé : aucun appel ne part. Réactive-le pour l\u0027appeler.`, extracted: null, ms: 0 };
    }
    const built = buildWebhookRequest(endpoint, payload);
    if (!built.ok) {
      await this.record(endpoint, { status: null, error: built.summary });
      return { ok: false, status: null, summary: `${label} : ${built.summary}`, extracted: null, ms: 0 };
    }
    const exchange = await sendWebhookRequest(built.request);
    if (!exchange.ok) {
      await this.record(endpoint, { status: null, error: exchange.summary });
      return { ok: false, status: null, summary: `${label} : ${exchange.summary}`, extracted: null, ms: exchange.ms };
    }
    const ok = exchange.status >= 200 && exchange.status < 300;
    const detail = statusDetail(exchange.status, exchange.unfollowedRedirect);
    const { value, truncated } = extractResponseValue(exchange.body, built.request.extractPath);
    const summary = ok ? `${label} : HTTP ${exchange.status} en ${exchange.ms} ms.` : `${label} : HTTP ${exchange.status}${detail}.`;
    await this.record(endpoint, { status: exchange.status, error: ok ? null : `HTTP ${exchange.status}${detail}` });
    return {
      ok,
      status: exchange.status,
      summary: truncated ? `${summary} Valeur extraite trop volumineuse : aperçu tronqué.` : summary,
      extracted: value,
      ms: exchange.ms,
    };
  }

  /** Dernier statut de la ligne. Un échec de cette écriture ne perd jamais le résultat de l'appel. */
  private async record(endpoint: WebhookEndpoint, outcome: { status: number | null; error: string | null }): Promise<void> {
    try {
      await this.prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { lastHttpStatus: outcome.status, lastCheckedAt: new Date(), lastError: outcome.error?.slice(0, LAST_ERROR_MAX) ?? null },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log.warn(`dernier statut du connecteur « ${endpoint.slug} » non consigné : ${reason.slice(0, 120)}`);
    }
  }
}

/** Ce qu'un statut dit de plus au staff, en parenthèse du résumé : rien sur une réussite. */
function statusDetail(status: number, unfollowedRedirect: boolean): string {
  if (unfollowedRedirect) return ' (redirection vers une autre origine, non suivie)';
  if (status === 401 || status === 403) return ' (authentification refusée par le service distant)';
  if (status === 404) return ' (adresse introuvable côté service distant)';
  if (status === 429) return ' (limite d\u0027appels du service distant atteinte)';
  if (status >= 500) return ' (erreur du service distant)';
  return '';
}
