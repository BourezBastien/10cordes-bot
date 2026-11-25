import { ValidationError } from '@spraxium/http';
import type { IntegrationTestResult, IntegrationUpdate, IntegrationView } from '@10cordes/shared';
import { z } from 'zod';
import { assertPublicHost, assertSafeUrl, safeFetch } from '../../shared/utils/safe-fetch';
import type { IntegrationDef } from '../integrations/integration.service';
import { INTEGRATION_CATALOG } from '../integrations/integration.service';
import { keyHintOf, type GuildIntegration, type OwnedIntegration } from '../integrations/guild-integration.service';

/**
 * Ce dont l'API des intégrations a besoin autour de `GuildIntegrationService` :
 * la vue montrée au dashboard, la traduction d'une mise à jour vers les
 * conventions du service, et le test d'accès. Tout y est pur, sauf le test.
 */

/** Intégrations de SERVICE (PixelLab...) : ni un fournisseur de modèles, ni de la musique. */
export function isServiceIntegration(def: IntegrationDef): boolean {
  return def.kind !== 'llm' && def.kind !== 'music';
}

export const SERVICE_INTEGRATIONS: readonly IntegrationDef[] = INTEGRATION_CATALOG.filter(isServiceIntegration);

/** L'intégration de service de ce slug, ou null : slug inconnu, ou fournisseur de modèles (une autre API). */
export function serviceIntegrationOf(slug: string): IntegrationDef | null {
  return SERVICE_INTEGRATIONS.find((def) => def.id === slug) ?? null;
}

/** Vue d'une intégration pour le dashboard : la clé n'y paraît jamais, seulement sa présence et son extrait. */
export function integrationView(def: IntegrationDef, resolved: GuildIntegration): IntegrationView {
  return {
    slug: def.id,
    name: def.label,
    tools: [...def.tools],
    source: resolved.origin,
    enabled: resolved.enabled,
    baseUrl: resolved.config.baseUrl ?? null,
    key: { hasApiKey: Boolean(resolved.config.apiKey), keyHint: keyHintOf(resolved.config.apiKey) },
    model: resolved.config.model ?? null,
  };
}

/** Ce qu'une mise à jour demande à `GuildIntegrationService.upsert`. */
export interface GuildIntegrationFields {
  apiKey?: string | null;
  baseUrl?: string | null;
  enabled?: boolean;
}

/**
 * Contrat du dashboard vers les conventions du service, pour la clé :
 *
 *   dashboard   absent, `undefined`, chaîne VIDE  ->  la clé du serveur est conservée ; `null` -> retirée
 *   service     `undefined` -> conservée ; chaîne vide ou `null` -> retirée
 *
 * La chaîne vide change donc de sens : c'est l'écart à combler. Une clé
 * s'écrit débarrassée de ses espaces (artefact d'un copier-coller), comme dans
 * la modale Discord.
 */
export function integrationUpdateToFields(update: IntegrationUpdate): GuildIntegrationFields {
  const apiKey = update.apiKey?.trim();
  return {
    ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
    ...(update.apiKey === null ? { apiKey: null } : apiKey ? { apiKey } : {}),
    ...(update.baseUrl !== undefined ? { baseUrl: update.baseUrl } : {}),
  };
}

/**
 * La clé de l'INSTANCE ne part que vers l'adresse de l'instance. Un serveur qui
 * n'a pas sa propre clé ne fixe donc pas d'adresse : sans cette règle, n'importe
 * quel gérant de serveur ferait envoyer la clé commune par le bot à l'hôte de
 * son choix. Retirer la clé d'un serveur qui en a une se fait donc avec son adresse.
 */
export function assertInstanceKeyStaysHome(owned: OwnedIntegration | null, fields: GuildIntegrationFields): void {
  const hasOwnKey = fields.apiKey === undefined ? (owned?.hasApiKey ?? false) : fields.apiKey !== null;
  const baseUrl = fields.baseUrl === undefined ? (owned?.baseUrl ?? null) : fields.baseUrl;
  if (baseUrl !== null && !hasOwnKey) {
    throw new ValidationError([
      {
        property: 'baseUrl',
        constraints: {
          message:
            'Une adresse personnalisée exige la clé propre de ce serveur : la clé de l\u0027instance n\u0027est envoyée qu\u0027à l\u0027adresse de l\u0027instance. Donne une clé, ou retire l\u0027adresse (baseUrl à null).',
        },
      },
    ]);
  }
}

/**
 * Une adresse d'intégration, contrôlée à l'écriture comme `safeFetch` le sera à
 * chaque appel : https, hôte public (sur sa forme et sur ce qu'il résout), sans
 * identifiant (l'adresse est montrée à tout gérant du serveur).
 */
export async function assertIntegrationBaseUrl(baseUrl: string): Promise<void> {
  const refused = (reason: string): ValidationError => new ValidationError([{ property: 'baseUrl', constraints: { message: `Adresse refusée : ${reason}` } }]);
  let parsed: URL;
  try {
    parsed = assertSafeUrl(baseUrl);
  } catch {
    throw refused('https obligatoire, sur un hôte public (ni localhost, ni adresse privée ou réservée).');
  }
  if (parsed.username || parsed.password) throw refused('aucun identifiant dans l\u0027adresse.');
  if (parsed.search || parsed.hash) throw refused('ni requête ni fragment : l\u0027API ajoute son propre chemin.');
  try {
    await assertPublicHost(parsed.hostname);
  } catch {
    throw refused('cet hôte résout vers une adresse locale, privée ou réservée.');
  }
}

/** Lecture authentifiée de PixelLab qui ne consomme rien : le solde du compte (`GET /v2/balance`, « Get balance » de son OpenAPI). */
const PIXELLAB_BALANCE_PATH = '/v2/balance';
/** Adresse officielle de PixelLab quand ni le serveur ni l'instance n'en donnent (même valeur que `PIXELLAB_BASE_URL` d'imagelab.service.ts). */
const PIXELLAB_BASE_URL = 'https://api.pixellab.ai';
const ACCESS_TEST_TIMEOUT_MS = 10_000;
/** Un solde tient en quelques octets : au-delà, le corps n'est pas lu. */
const MAX_BALANCE_BYTES = 16 * 1024;

/** Corps de `GET /v2/balance` (OpenAPI de PixelLab, `BalanceResponse`). Tout champ manque sans fauter. */
const PixelLabBalanceSchema = z.object({
  credits: z.object({ usd: z.number().optional() }).optional(),
  subscription: z.object({ status: z.string().optional(), generations: z.number().optional(), total: z.number().optional() }).optional(),
});

type PixelLabBalance = z.output<typeof PixelLabBalanceSchema>;

/** Test d'accès d'une intégration : celui de PixelLab aujourd'hui, un constat honnête pour les autres. */
export async function testIntegrationAccess(slug: string, credentials: { apiKey: string; baseUrl: string | null }): Promise<IntegrationTestResult> {
  if (slug !== 'pixellab') return { ok: false, summary: 'Aucun test d\u0027accès n\u0027est prévu pour cette intégration.', status: null, ms: 0 };
  return testPixelLabAccess({ apiKey: credentials.apiKey, baseUrl: credentials.baseUrl ?? PIXELLAB_BASE_URL });
}

async function testPixelLabAccess(credentials: { apiKey: string; baseUrl: string }): Promise<IntegrationTestResult> {
  const started = Date.now();
  const result = (ok: boolean, summary: string, status: number | null): IntegrationTestResult => ({ ok, summary, status, ms: Date.now() - started });
  let response: Response;
  try {
    response = await safeFetch(`${credentials.baseUrl.replace(/\/+$/u, '')}${PIXELLAB_BALANCE_PATH}`, {
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
      timeoutMs: ACCESS_TEST_TIMEOUT_MS,
    });
  } catch (error) {
    return result(false, `PixelLab injoignable (${unreachableReason(error)}) : vérifie l\u0027adresse de base et la connexion du bot.`, null);
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return result(false, refusalSummary(response.status), response.status);
  }
  const balance = PixelLabBalanceSchema.safeParse(await boundedJson(response).catch(() => null));
  return result(true, `Clé PixelLab acceptée (${describeBalance(balance.success ? balance.data : null)}).`, 200);
}

/** Réponse du service, en refus : le statut dit lequel, sans rien supposer du corps. */
function refusalSummary(status: number): string {
  if (status === 401 || status === 403) return `Clé refusée par PixelLab (${status}) : invalide, révoquée, ou sans droit sur ce compte.`;
  if (status === 402) return 'Crédits PixelLab insuffisants (402) : la clé est reconnue, le compte n\u0027a plus de crédits.';
  if (status === 429 || status === 529) return `Trop de demandes vers PixelLab (${status}) : réessaie dans un instant.`;
  if (status >= 500) return `PixelLab ne répond pas correctement (${status}) : réessaie plus tard.`;
  return `Réponse inattendue de PixelLab (${status}) : vérifie l\u0027adresse de base.`;
}

/** Pourquoi la requête n'a pas abouti, sans recopier le message brut (il porte l'adresse demandée). */
function unreachableReason(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return `délai de ${ACCESS_TEST_TIMEOUT_MS / 1000} s dépassé`;
  if (error instanceof TypeError) return 'erreur réseau';
  return 'adresse refusée par la garde d\u0027URL du bot';
}

/** JSON d'une petite réponse, plafonné en taille : null si trop lourd ou illisible. */
async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BALANCE_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BALANCE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown;
}

/** Le solde en une phrase : ce que la réponse dit, rien de plus. */
function describeBalance(balance: PixelLabBalance | null): string {
  if (!balance) return 'solde non lisible';
  const parts: string[] = [];
  if (balance.credits?.usd !== undefined) parts.push(`${balance.credits.usd.toFixed(2).replace('.', ',')} $ de crédits`);
  if (balance.subscription?.generations !== undefined) parts.push(`${balance.subscription.generations} générations restantes sur ${balance.subscription.total ?? '?'}`);
  if (balance.subscription?.status) parts.push(`abonnement ${balance.subscription.status}`);
  return parts.length > 0 ? parts.join(', ') : 'solde non communiqué';
}
