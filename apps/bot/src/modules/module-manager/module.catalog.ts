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
    commands: ['logs'],
    dependsOn: [],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    description: 'Warns, cases, timeouts, kicks, bans, purge, derank with role backup.',
    commands: ['mod'],
    dependsOn: [],
  },
  {
    id: 'tags',
    label: 'Tags',
    description: 'Custom tag commands stored per server.',
    commands: ['tag'],
    dependsOn: [],
  },
  {
    id: 'tickets',
    label: 'Tickets',
    description: 'Support tickets with claim, close, transcripts and logs.',
    commands: ['ticket'],
    dependsOn: [],
  },
  {
    id: 'roles',
    label: 'Reaction roles',
    description: 'Self-serve role menu, editable live.',
    commands: ['roles'],
    dependsOn: [],
  },
  {
    id: 'levels',
    label: 'Levels',
    description: 'XP per message, role rewards, leaderboard and announcements.',
    commands: ['rank', 'leaderboard'],
    dependsOn: [],
    recommends: [],
  },
];

export function findModuleById(moduleId: string): ModuleDescriptor | undefined {
  return MODULE_CATALOG.find((module) => module.id === moduleId);
}

export function findModuleByCommand(commandName: string): ModuleDescriptor | undefined {
  const name = commandName.toLowerCase();
  return MODULE_CATALOG.find((module) => module.commands.includes(name));
}
