import type { WebhookEndpointView } from '@10cordes/shared';
import type { WebhookEndpointSummary } from './webhook-endpoint.codec';

/**
 * Vue d'un connecteur HTTP sortant, telle que l'API la rend. POO pure : des
 * données en (un connecteur SANS ses en-têtes secrets, un
 * `WebhookEndpointSummary`), la vue du contrat en. Zéro effet de bord.
 *
 * Des en-têtes secrets, la vue ne montre que les NOMS. Les dates sont des
 * chaînes ISO, `domain` est l'hôte de l'URL, `requestTemplate` le gabarit
 * parsé (ou null). Chaque champ est borné aux limites du contrat : une ligne
 * écrite hors du service ne fait pas échouer la lecture d'une liste.
 */
export class WebhookEndpointPresenter {
  present(summary: WebhookEndpointSummary): WebhookEndpointView {
    return {
      webhookId: summary.id,
      slug: summary.slug,
      name: summary.name.slice(0, 80),
      method: summary.method,
      url: summary.url.slice(0, 500),
      domain: domainOf(summary.url),
      authType: summary.authType,
      authHeaderName: summary.authHeaderName?.slice(0, 60) ?? null,
      publicHeaders: publicHeadersOf(summary.publicHeaders),
      secretHeaderNames: secretHeaderNamesOf(summary.secretHeaderNames),
      requestTemplate: summary.requestTemplate ?? null,
      responseExtractPath: summary.responseExtractPath,
      enabled: summary.enabled,
      lastHttpStatus: summary.lastHttpStatus,
      lastCheckedAt: summary.lastCheckedAt?.toISOString() ?? null,
      lastError: summary.lastError?.slice(0, 300) ?? null,
      createdAt: summary.createdAt.toISOString(),
      updatedAt: summary.updatedAt.toISOString(),
    };
  }
}

/** Hôte de l'URL du connecteur, sans le chemin ; l'URL elle-même si elle est illisible. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.slice(0, 253);
  } catch {
    return url.slice(0, 253);
  }
}

/** En-têtes publics montrés : noms non vides de 60 caractères au plus, valeurs de 1000. */
function publicHeadersOf(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([header]) => header.trim().length > 0)
      .map(([header, value]) => [header.slice(0, 60), value.slice(0, 1000)]),
  );
}

/** Noms des en-têtes secrets : non vides, bornés, uniques, triés. */
function secretHeaderNamesOf(names: readonly string[]): string[] {
  return [...new Set(names.filter((header) => header.length > 0).map((header) => header.slice(0, 60)))].sort();
}
