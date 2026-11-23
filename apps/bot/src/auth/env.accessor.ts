import { EnvValidator } from '@spraxium/env';
import { AppEnv } from '../app.env';

let cached: AppEnv | undefined;

/**
 * Env validé SANS passer par le DI : les guards HTTP sont instanciés par le
 * serveur HTTP dans un container qui ne voit pas toujours le `provide(AppEnv)`
 * du host (confinement de container). process.env est déjà chargé à ce stade.
 */
export function getValidatedEnv(): AppEnv {
  cached ??= EnvValidator.validate(AppEnv);
  return cached;
}
