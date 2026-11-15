/** Déclaration d'un module togglable du bot (source de vérité partagée bot + dashboard). */
export interface ModuleDescriptor {
  /** Identifiant stable (kebab-case) — clé de persistance. */
  id: string;
  /** Nom affiché aux utilisateurs. */
  label: string;
  /** Description courte. */
  description: string;
  /** Noms racines des slash commands contrôlées par ce module. */
  commands: string[];
  /** Groupe d'affichage optionnel (sous-modules rattachés à un module principal). */
  group?: string;
  /** Modules obligatoires — si inactifs, ce module est bloqué. */
  dependsOn: string[];
  /** Modules conseillés — proposés (jamais imposés) à l'activation. */
  recommends?: string[];
}
