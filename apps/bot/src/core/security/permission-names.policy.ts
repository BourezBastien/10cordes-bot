/**
 * Policy « cette LISTE de permissions accorde-t-elle le droit ? ». Même contrat
 * que MemberPermissionPolicy, pour les contextes où le membre Discord n'est
 * plus disponible : `ToolRunContext.permissions` (jobs, triggers, canal web).
 *
 * Administrator ouvre tout ; un nom inconnu n'est jamais accordé ; une liste
 * vide n'accorde rien.
 */

export class PermissionNamesPolicy {
  readonly policyName = 'PermissionNames';

  /** La liste porte-t-elle Administrator ? */
  isAdmin(permissionNames: readonly string[]): boolean {
    return permissionNames.includes('Administrator');
  }

  /** La liste accorde-t-elle cette permission (ou Administrator) ? */
  has(permissionNames: readonly string[], permission: string): boolean {
    return this.isAdmin(permissionNames) || permissionNames.includes(permission);
  }

  /** La liste accorde-t-elle AU MOINS UNE des permissions demandées ? */
  hasAny(permissionNames: readonly string[], permissions: readonly string[]): boolean {
    return permissions.some((permission) => this.has(permissionNames, permission));
  }

  /** La liste accorde-t-elle TOUTES les permissions demandées ? */
  hasAll(permissionNames: readonly string[], permissions: readonly string[]): boolean {
    return permissions.every((permission) => this.has(permissionNames, permission));
  }

  /** Permissions demandées mais absentes (liste vide = tout est accordé). */
  missing(permissionNames: readonly string[], permissions: readonly string[]): string[] {
    if (this.isAdmin(permissionNames)) return [];
    return permissions.filter((permission) => !permissionNames.includes(permission));
  }
}

/** Instance singleton (la policy est sans état). */
export const permissionNamesPolicy = new PermissionNamesPolicy();
