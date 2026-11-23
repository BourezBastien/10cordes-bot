/** Déclaration d'un module togglable du bot (source de vérité partagée bot + dashboard). */
export interface ModuleDescriptor {
  /** Identifiant stable (kebab-case) — clé de persistance. */
  id: string;
  /** Nom affiché aux utilisateurs. */
  label: string;
  /** Description courte. */
  description: string;
  /** Modules obligatoires — si inactifs, ce module est bloqué. */
  dependsOn: string[];
  /**
   * Modules optionnels — sans eux, une PARTIE de la fonctionnalité est indisponible
   * (le module reste utilisable). Ex: `birthdays` sans `economy` = pas de cadeau.
   */
  optionalDeps?: string[];
  /** Modules conseillés — proposés (jamais imposés) à l'activation. */
  recommends?: string[];
}
