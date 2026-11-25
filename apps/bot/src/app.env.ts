import { EnvSchema, SpraxiumBaseEnv, Env, IsString, IsOptional, IsPort, Secret } from '@spraxium/env';

/**
 * ENV MINIMALE (R1) : le strict noyau pour booter. Les clés des fournisseurs
 * (IA, kie.ai, PixelLab) vivent en base, chiffrées (table IntegrationConfig).
 * Ces variables ne servent qu'à remplir une ligne manquante, une fois, à
 * l'amorçage (IntegrationService.importFromEnv) : ensuite la base a la
 * priorité absolue et elles peuvent être commentées.
 *
 * Requise au boot : DISCORD_TOKEN (héritée de SpraxiumBaseEnv).
 * Tout le reste a un défaut sain ou est optionnel.
 */
@EnvSchema()
export class AppEnv extends SpraxiumBaseEnv {
  // ── Infrastructure ──

  @Env('DATABASE_URL', { default: 'file:../data/bot.db', secret: false })
  @IsString()
  DATABASE_URL!: string;

  /** Redis pour queue durable + cache temps réel. Vide = mémoire (dev). */
  @Env('REDIS_URL', { default: '', secret: false })
  REDIS_URL!: string;

  @Env('PORT', { default: '3000', secret: false })
  @IsPort()
  PORT!: number;

  /** Bind du serveur HTTP : 0.0.0.0 en Docker, 127.0.0.1 en local. */
  @Env('HTTP_HOST', { default: '127.0.0.1', secret: false })
  @IsString()
  HTTP_HOST!: string;

  /** Origine(s) du dashboard autorisées : CORS, login et contrôle d'origine. Plusieurs adresses séparées par des virgules. */
  @Env('DASHBOARD_ORIGIN', { default: 'http://localhost:5173', secret: false })
  @IsString()
  DASHBOARD_ORIGIN!: string;

  /** Dossier du panel compilé (build de apps/dashboard). Réglé, le bot le sert lui-même sur son propre serveur HTTP. */
  @Env('DASHBOARD_DIST_DIR')
  @IsOptional()
  @Secret()
  @IsString()
  DASHBOARD_DIST_DIR?: string;

  /** Secret better-auth (min 32 chars), requis pour l'API/dashboard. Sans ENCRYPTION_SECRET, c'est la clé maîtresse qui chiffre la base. */
  @Env('BETTER_AUTH_SECRET')
  @IsOptional()
  @Secret()
  @IsString()
  BETTER_AUTH_SECRET?: string;

  /** Identifiant OAuth Discord (application), requis pour le login dashboard. */
  @Env('DISCORD_CLIENT_ID', { secret: false })
  @IsOptional()
  @IsString()
  DISCORD_CLIENT_ID?: string;

  /** Secret OAuth Discord, requis pour le login dashboard. */
  @Env('DISCORD_CLIENT_SECRET')
  @IsOptional()
  @Secret()
  @IsString()
  DISCORD_CLIENT_SECRET?: string;

  /** Clé API serveur à serveur (en-tête x-api-key) de la sonde `/healthz`. Optionnelle : sans elle, la sonde est ouverte. */
  @Env('HTTP_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  HTTP_API_KEY?: string;

  /** Clé maîtresse de chiffrement des secrets en base (AES-256-GCM). Vide : dérivée de BETTER_AUTH_SECRET. A changer, et plus rien ne se déchiffre. */
  @Env('ENCRYPTION_SECRET')
  @IsOptional()
  @Secret()
  @IsString()
  ENCRYPTION_SECRET?: string;

  // ── Clés des fournisseurs : importées en base au démarrage quand la ligne
  // manque, puis ignorées (la base a la priorité absolue) ──

  /** Base URL compatible OpenAI : https://api.deepseek.com, https://api.openai.com/v1, https://openrouter.ai/api/v1... */
  @Env('LLM_API_URL')
  @IsOptional()
  @Secret()
  @IsString()
  LLM_API_URL?: string;

  @Env('LLM_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  LLM_API_KEY?: string;

  @Env('LLM_MODEL')
  @IsOptional()
  @Secret()
  @IsString()
  LLM_MODEL?: string;

  /** Clé kie.ai (musique, images, vidéos). */
  @Env('KIE_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  KIE_API_KEY?: string;

  /** Modèle kie.ai par défaut (par exemple V6_MINI pour la musique). */
  @Env('KIE_MODEL')
  @IsOptional()
  @Secret()
  @IsString()
  KIE_MODEL?: string;

  /** Clé PixelLab (pixel art). */
  @Env('PIXELLAB_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  PIXELLAB_API_KEY?: string;

  /** Effort de raisonnement (thinking) : low/medium/high. Vide = non envoyé. */
  @Env('LLM_EFFORT', { default: '', secret: false })
  @IsString()
  LLM_EFFORT!: string;

  // ── Dev rigs ──

  /** Master switch des rigs E2E : true = la gate accepte les webhooks du bot nommés agent-e2e-guardian. */
  @Env('E2E_ENABLED', { default: 'false', secret: false })
  @IsString()
  E2E_ENABLED!: string;
}
