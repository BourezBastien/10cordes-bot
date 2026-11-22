import { EnvSchema, SpraxiumBaseEnv, Env, IsString, IsOptional, IsPort, Secret } from '@spraxium/env';

@EnvSchema()
export class AppEnv extends SpraxiumBaseEnv {
  @Env('DATABASE_URL', { default: 'file:../data/bot.db', secret: false })
  @IsString()
  DATABASE_URL!: string;

  @Env('PORT', { default: '3000', secret: false })
  @IsPort()
  PORT!: number;

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

  /** PixelLab API — génération pixel art (icônes, emojis). Requis pour le module image. */
  @Env('PIXELLAB_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  PIXELLAB_API_KEY?: string;

  /** DeepSeek (LLM de l'agent) — https://api.deepseek.com, compatible OpenAI. */
  @Env('DEEPSEEK_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  DEEPSEEK_API_KEY?: string;

  @Env('REDIS_URL', { default: 'redis://127.0.0.1:6379', secret: false })
  REDIS_URL!: string;

  @Env('DEEPSEEK_MODEL', { default: 'deepseek-flash', secret: false })
  @IsString()
  DEEPSEEK_MODEL!: string;

  /** Effort de raisonnement du modèle thinking : low = réponses rapides. */
  @Env('DEEPSEEK_EFFORT', { default: 'low', secret: false })
  DEEPSEEK_EFFORT!: string;

  /**
   * Master switch des rigs de test E2E (R4 self-contained) : true = la gate
   * accepte les webhooks créés PAR le bot nommés agent-e2e-guardian.
   */
  @Env('E2E_ENABLED', { default: 'false', secret: false })
  @IsString()
  E2E_ENABLED!: string;

  /** kie.ai (génération musicale Suno) — requis pour le tool generateMusic. */
  @Env('KIE_API_KEY')
  @IsOptional()
  @Secret()
  @IsString()
  KIE_API_KEY?: string;

  /** Modèle Suno : V6_MINI (meilleur ratio qualité/prix) ou V6 (qualité max). */
  @Env('KIE_MODEL', { default: 'V6_MINI', secret: false })
  @IsString()
  KIE_MODEL!: string;
}
