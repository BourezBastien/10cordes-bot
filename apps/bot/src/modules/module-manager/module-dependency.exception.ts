import { SpraxiumException } from '@spraxium/core';

/** Levée quand une dépendance obligatoire du module est inactive. */
export class ModuleDependencyException extends SpraxiumException {
  constructor(moduleLabel: string, dependencyLabels: string) {
    super({
      code: 'MODULE_DEPENDENCY',
      message: 'The **{{label}}** module requires the following modules: **{{dependencies}}**.',
      props: { label: moduleLabel, dependencies: dependencyLabels },
    });
  }
}
