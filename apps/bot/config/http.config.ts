import { defineHttp } from '@spraxium/http';
import { AppModule } from '../src/app.module';
import { httpSecurity } from '../src/modules/api/http-security';

/**
 * Serveur HTTP du bot : API du dashboard, login, sonde, et (production) panel.
 *
 * Pas de clé API globale : elle exigeait `x-api-key` sur TOUTE route, login
 * Discord compris, que le navigateur n'envoie pas. La clé protège la sonde du
 * processus (`ProbeKeyGuard` sur `/healthz`) ; les routes du dashboard
 * s'authentifient par la session, et le contrôle d'origine des requêtes qui
 * modifient vit dans `ApiPolicyMiddleware`.
 *
 * La sécurité du serveur (CSP, CORS) vient de `httpSecurity` : la CSP du
 * framework y est désactivée, elle vit dans `ApiPolicyMiddleware`.
 */
export const httpConfig = defineHttp({
  enabled: true,
  // 127.0.0.1 par défaut (dev local : l'API n'est PAS exposée hors machine).
  // En conteneur, docker-compose pose HTTP_HOST=0.0.0.0 pour que le port
  // publié soit réellement joignable.
  host: process.env.HTTP_HOST ?? '127.0.0.1',
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  sharding: false,
  module: AppModule,
  // Origines admises du dashboard, séparées par des virgules ; la première porte le rappel du login Discord.
  security: httpSecurity(process.env.DASHBOARD_ORIGIN),
});
