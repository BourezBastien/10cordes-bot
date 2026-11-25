import type { HttpMiddleware } from '@spraxium/http';
import type { Context, Next } from 'hono';
import { normalizeOrigin } from '../../auth/auth-origins';

/** CSP des pages HTML rendues par le bot (panel compilé, mentions légales) : le serveur lui-même, et rien d'autre. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data: https://cdn.discordapp.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** CSP de tout le reste (l'API, la sonde, les ressources) : celle que le framework posait sur chaque réponse. */
export const API_CSP = "default-src 'none'";

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Règles communes à l'API du dashboard, avant toute route :
 *
 * - `Cache-Control: no-store` et `X-Robots-Tag: noindex` sur tout `/api/` :
 *   une réponse du dashboard ne se met pas en cache et ne s'indexe pas ;
 * - contrôle d'origine : toute requête de `/api/v1` qui modifie (hors GET)
 *   doit venir d'une origine autorisée du dashboard. La session voyage dans un
 *   cookie : sans cette vérification, une page tierce pourrait faire
 *   modifier le serveur par le navigateur d'un membre connecté (CSRF) ;
 * - CSP : `default-src 'none'` sur chaque réponse, hors d'une page HTML du
 *   bot (panel compilé, mentions légales), qui reçoit la CSP des pages. Le
 *   framework écrase la CSP après le handler, avec une seule valeur pour
 *   toutes : la sienne est désactivée dans `config/http.config.ts` et la
 *   règle vit ici. Elle se lit sur la réponse finale, et jamais sous `/api/`.
 *
 * Une règle est posée deux fois : avant la route (une réponse d'erreur, d'une
 * garde ou d'une exception, la porte aussi), puis sur la réponse finale (une
 * route qui rend une `Response` toute prête ne reçoit pas les en-têtes
 * préparés).
 *
 * Les origines sont lues à la requête (accesseur), jamais à l'import : le
 * middleware est construit à la définition du module, avant l'environnement.
 */
export class ApiPolicyMiddleware implements HttpMiddleware {
  constructor(private readonly origins: () => ReadonlyArray<string>) {}

  async handle(ctx: Context, next: Next): Promise<undefined | Response> {
    const path = ctx.req.path;
    const isApi = path === '/api' || path.startsWith('/api/');
    // D'abord la CSP : un refus d'origine, rendu ici, la porte aussi.
    ctx.header('Content-Security-Policy', API_CSP);
    if (isApi) {
      ctx.header('Cache-Control', 'no-store');
      ctx.header('X-Robots-Tag', 'noindex, nofollow');
      if (path.startsWith('/api/v1/') && MUTATING_METHODS.has(ctx.req.method.toUpperCase()) && !this.isTrusted(ctx)) {
        return ctx.json({ ok: false, error: 'Origine non autorisée pour cette requête.' }, 403);
      }
    }
    await next();
    ctx.res.headers.set('Content-Security-Policy', isApi ? API_CSP : cspOf(ctx.res.headers.get('content-type')));
    if (isApi) {
      ctx.res.headers.set('Cache-Control', 'no-store');
      ctx.res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return undefined;
  }

  /**
   * Origine déclarée par le navigateur, parmi celles autorisées. `Origin`
   * quand il est présent : sa présence clôt la question, même quand il vaut
   * « null » (une page sans origine), sans recourir au `Referer` ; sinon le
   * `Referer`.
   */
  private isTrusted(ctx: Context): boolean {
    const origin = ctx.req.header('origin');
    const declared = normalizeOrigin(origin !== undefined ? origin : ctx.req.header('referer'));
    return declared !== null && this.origins().includes(declared);
  }
}

/** La CSP d'une réponse : celle des pages pour une page HTML (la seule qui puisse charger ses scripts), celle de l'API pour tout le reste. */
export function cspOf(contentType: string | null | undefined): string {
  return (contentType ?? '').toLowerCase().startsWith('text/html') ? PAGE_CSP : API_CSP;
}
