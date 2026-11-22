import { EnvSchema, SpraxiumBaseEnv, Env, IsString, IsOptional, IsPort, Secret } from '@spraxium/env';

/**
 * ENV MINIMALE (R1) : le strict noyau pour booter. TOUT fournisseur IA
 * (LLM, image, musique...) se configure soit via ces variables génériques
 * de bootstrap, soit directement depuis Discord (modal par bouton — les
 * clés sont alors stockées chiffrées en DB, voir IntegrationService).
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

  /** Origine du dashboard autorisée en CORS. */
  @Env('DASHBOARD_ORIGIN', { default: 'http://localhost:5173', secret: false })
  @IsString()
  DASHBOARD_ORIGIN!: string;

  /** Secret better-auth (min 32 chars) — requis pour l'API/dashboard. */
  @Env('BETTER_AUTH_SECRET')
  @IsOptional()
  @Secret()
  @IsString()
  BETTER_AUTH_SECRET?: string;

  /** Secret OAuth Discord — requis pour le login dashboard. */
  @Env('DISCORD_CLIENT_SECRET')
  @IsOptional()
  @Secret()
  @IsString()
  DISCORD_CLIENT_SECRET?: string;

  /** Clé API serveur-à-serveur (header x-api-key) — optionnelle. */
  @Env('HTTP_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  HTTP_API_KEY?: string;

  /** Clé de chiffrement des secrets en DB (AES-256-GCM). Vide = dérivée de BETTER_AUTH_SECRET. */
  @Env('ENCRYPTION_SECRET')
  @IsOptional()
  @Secret()
  @IsString()
  ENCRYPTION_SECRET?: string;

  // ── Bootstrap LLM (optionnel : tout aussi configurable par modal Discord) ──

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
