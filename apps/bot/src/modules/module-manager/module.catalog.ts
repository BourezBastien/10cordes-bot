import type { ModuleDescriptor } from '@10cordes/shared';

/**
 * Registre des modules togglables.
 * Ajouter une entrée ici à la création d'un module — c'est ce qui branche
 * le guard, l'autocomplétion, le graphe de dépendances et le dashboard.
 */
export const MODULE_CATALOG: ModuleDescriptor[] = [
  {
    id: 'logging',
    label: 'Logging',
    description: 'Message, member, voice and ban logs routed per category.',
    commands: [],
    setupGroups: ['logs'],
    dependsOn: [],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    description: 'Warns, cases, timeouts, kicks, bans, purge, derank with role backup.',
    commands: [],
    setupGroups: ['moderation'],
    dependsOn: [],
  },
  {
    id: 'tickets',
    label: 'Tickets',
    description: 'Support tickets with claim, close, transcripts and logs.',
    commands: [],
    setupGroups: ['tickets'],
    dependsOn: [],
  },
  {
    id: 'roles',
    label: 'Reaction roles',
    description: 'Self-serve role menu, editable live.',
    commands: [],
    setupGroups: ['roles'],
    dependsOn: [],
  },
  {
    id: 'levels',
    label: 'Levels',
    description: 'XP per message, role rewards, leaderboard and announcements.',
    commands: [],
    dependsOn: [],
    recommends: [],
  },
];

export function findModuleById(moduleId: string): ModuleDescriptor | undefined {
  return MODULE_CATALOG.find((module) => module.id === moduleId);
}

export function findModuleByCommand(commandName: string, group?: string): ModuleDescriptor | undefined {
  const name = commandName.toLowerCase();
  if (group) {
    const byGroup = MODULE_CATALOG.find((module) => module.setupGroups?.includes(group.toLowerCase()));
    if (byGroup) return byGroup;
  }
  return MODULE_CATALOG.find((module) => module.commands.includes(name));
}
