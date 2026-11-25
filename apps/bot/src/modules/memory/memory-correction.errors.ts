/*
 * Refus d'une correction de mémoire : le contrat la refuse avant toute
 * écriture (fait trop court ou trop long, correction qui répète le fait,
 * membre qui a demandé à être oublié). Classe à part : le service et l'outil
 * la lisent sans dépendre l'un de l'autre.
 */

export class CorrectionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorrectionRefusedError';
  }
}
