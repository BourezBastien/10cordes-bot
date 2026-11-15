import type { ModuleDescriptor } from '@10cordes/shared';

/**
 * Registre des modules togglables.
 * Ajouter une entrée ici à la création d'un module — c'est ce qui branche
 * le guard, l'autocomplétion, le graphe de dépendances et le dashboard.
 */
export const MODULE_CATALOG: ModuleDescriptor[] = [
  {
    id: 'ping',
    label: 'Ping',
    description: 'Latency check command.',
    commands: ['ping'],
    dependsOn: [],
  },
];

export function findModuleById(moduleId: string): ModuleDescriptor | undefined {
  return MODULE_CATALOG.find((module) => module.id === moduleId);
}

export function findModuleByCommand(commandName: string): ModuleDescriptor | undefined {
  const name = commandName.toLowerCase();
  return MODULE_CATALOG.find((module) => module.commands.includes(name));
}
