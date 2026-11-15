import { EnvSchema, SpraxiumBaseEnv, Env, IsString } from '@spraxium/env';

@EnvSchema()
export class AppEnv extends SpraxiumBaseEnv {
  @Env('DATABASE_URL', { default: 'file:../data/bot.db', secret: false })
  @IsString()
  DATABASE_URL!: string;
}
