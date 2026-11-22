import type { ModuleDescriptor } from '@10cordes/shared';

/**
 * Registre des modules togglables PAR SERVEUR. Ajouter une entrée ici à la
 * création d'un module — c'est ce qui branche le dashboard, les tools
 * getModules/enableModule/disableModule et le graphe de dépendances.
 */
export const MODULE_CATALOG: ModuleDescriptor[] = [
  {
    id: 'logging',
    label: 'Logging',
    description: 'Message, member, voice and ban logs routed per category.',
    dependsOn: [],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    description: 'Warns, cases, timeouts, kicks, bans, purge, derank with role backup.',
    dependsOn: [],
  },
  {
    id: 'tickets',
    label: 'Tickets',
    description: 'Support tickets with claim, close, transcripts and logs.',
    dependsOn: [],
  },
  {
    id: 'roles',
    label: 'Reaction roles',
    description: 'Self-serve role menu, editable live.',
    dependsOn: [],
  },
];
