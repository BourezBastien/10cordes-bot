import { z } from 'zod';

/**
 * Macro : toute chaîne interpolée du moteur de surfaces ({{actor.id}},
 * {{state.<path>}}, {{steps.<n>.<field>}}...), bornée à 600 caractères.
 *
 * Interne au paquet : importé par les fichiers surface-*.ts, jamais
 * ré-exporté par la façade (surface.ts) ni par l'index.
 */
export const Macro = z.string().max(600);
