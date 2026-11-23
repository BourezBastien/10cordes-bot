import { MessageFlags, type ContainerBuilder } from 'discord.js';

/**
 * Payload Discord d'une surface : le conteneur Components V2 et le drapeau
 * IsComponentsV2 que l'API exige pour l'envoyer ou l'éditer. POO pure.
 */
export class SurfaceMessagePresenter {
  payload(container: ContainerBuilder): { flags: typeof MessageFlags.IsComponentsV2; components: ContainerBuilder[] } {
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }
}
