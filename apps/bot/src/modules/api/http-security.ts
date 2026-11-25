import { trustedOriginsOf } from '../../auth/auth-origins';

/**
 * Sécurité du serveur HTTP : ce que le code fixe, hors ce que lit
 * l'environnement. `config/http.config.ts` l'appelle avec la valeur de
 * `DASHBOARD_ORIGIN` ; un fichier de test ne peut pas importer la
 * configuration (elle vit hors du répertoire racine des sources).
 *
 * La CSP du framework est désactivée : il la pose après chaque handler, une
 * seule valeur pour toutes les réponses (`default-src 'none'`), ce qui
 * interdit au panel compilé ses scripts, ses styles et ses polices. Elle vit
 * dans `ApiPolicyMiddleware` (`API_CSP` partout, `PAGE_CSP` sur les seules
 * pages HTML du bot) ; `app.module.spec.ts` veille à cet accord.
 *
 * Le CORS garde les méthodes par défaut du framework (GET, POST, PUT, PATCH,
 * DELETE, OPTIONS).
 */
export function httpSecurity(dashboardOrigin: string | undefined) {
  return {
    headers: { contentSecurityPolicy: false },
    cors: {
      origins: trustedOriginsOf(dashboardOrigin ?? 'http://localhost:5173'),
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
      credentials: true,
      maxAge: 600,
    },
  };
}
