import { PermissionFlagsBits } from 'discord.js';

/**
 * Nom de permission Discord, typé depuis l'énumération de discord.js.
 *
 * Tout le code hors `core/security` désigne une permission par son NOM
 * (ManageGuild, SendMessages...) : la traduction en bitflag n'a lieu qu'ici.
 * L'audit d'architecture refuse `PermissionFlagsBits.` ailleurs.
 */
export type PermissionName = keyof typeof PermissionFlagsBits;

/** Bitflag d'une permission nommée. */
export function permissionFlag(permission: PermissionName): bigint {
  return PermissionFlagsBits[permission];
}

/**
 * Le nom désigne-t-il une permission Discord assignable dans un overwrite ?
 * `Administrator` est exclu (donner Administrator par overwrite n'a pas de sens
 * et ouvrait une brèche). `Object.hasOwn` rejette les propriétés héritées
 * (`toString`, `constructor`, `__proto__`).
 */
export function isAssignablePermissionName(name: string): name is PermissionName {
  return Object.hasOwn(PermissionFlagsBits as Record<string, unknown>, name) && name !== 'Administrator';
}

/** Le nom désigne-t-il une permission Discord (Administrator compris) ? Un nom inconnu n'accorde jamais rien. */
export function isPermissionName(name: string): name is PermissionName {
  return Object.hasOwn(PermissionFlagsBits as Record<string, unknown>, name);
}

/** Lecture sûre des permissions d'un membre (membre absent du cache = aucune). */
export function permissionsOf(member: { permissions?: { toArray(): string[] } } | null | undefined): string[] {
  return member?.permissions?.toArray() ?? [];
}

/** Identifiants des rôles d'un membre (pour les nœuds de permission allow/deny) ; membre absent = aucun. */
export function roleIdsOf(member: { roles?: { cache?: { keys(): Iterable<string> } } } | null | undefined): string[] {
  return [...(member?.roles?.cache?.keys() ?? [])];
}
