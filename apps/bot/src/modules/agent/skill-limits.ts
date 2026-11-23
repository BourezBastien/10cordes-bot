/**
 * Limites d'écriture d'un skill, partagées entre le service (validation à
 * la création) et les tools (bornes du paramsSchema de createSkill).
 */

/** Trigger : une seule ligne courte (caractères). */
export const TRIGGER_MAX = 120;
/** Règle : une seule ligne (caractères). */
export const RULE_MAX = 1500;

/** Ramène un texte à une seule ligne : espacements réduits à un espace, extrémités nettoyées. */
export const toSingleLine = (value: string): string => value.replaceAll(/\s+/gu, ' ').trim();
