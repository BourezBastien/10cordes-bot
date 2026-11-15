import { SpraxiumException } from '@spraxium/core';

export class ModuleDisabledException extends SpraxiumException {
  constructor(moduleLabel: string) {
    super({
      code: 'MODULE_DISABLED',
      message: 'The **{{label}}** module is currently disabled.',
      props: { label: moduleLabel },
    });
  }
}
