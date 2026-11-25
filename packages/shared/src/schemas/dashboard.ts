/**
 * Contrat du panel web (Lot 2) : façade des schémas du dossier. Un fichier
 * par groupe (voir dashboard-common.ts pour la liste) ; tout ce qui est
 * échangé entre l'API du bot et le dashboard est défini ici, validé par le
 * bot à l'entrée et lu par le dashboard à la sortie.
 */

export * from './dashboard-common.js';
export * from './dashboard-events.js';
export * from './dashboard-integrations.js';
export * from './dashboard-providers.js';
export * from './dashboard-rules.js';
export * from './dashboard-webhooks.js';
