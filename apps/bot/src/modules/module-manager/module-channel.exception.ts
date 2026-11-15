import { SpraxiumException } from '@spraxium/core';

/** Levée quand la commande est utilisée hors des salons whitelistés du module. */
export class ModuleChannelException extends SpraxiumException {
  constructor(moduleLabel: string) {
    super({
      code: 'MODULE_CHANNEL',
      message: 'The **{{label}}** module is restricted to specific channels.',
      props: { label: moduleLabel },
    });
  }
}
