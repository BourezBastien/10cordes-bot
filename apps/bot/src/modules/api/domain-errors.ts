import { HttpError, ValidationError } from '@spraxium/http';
import { ValidationException } from '@spraxium/core';
import { ZodError } from 'zod';
import { ProviderError } from '../providers/provider.types';
import { toHttpError } from './http-errors';

/** Refus typé du framework (`ValidationException`) en 400 : le champ en cause et la raison. */
function validationErrorOf(error: ValidationException): ValidationError {
  return new ValidationError([
    { property: String(error.props.field ?? 'body'), constraints: { message: String(error.props.reason ?? 'Valeur refusée.') } },
  ]);
}

/**
 * Erreur levée par un service, en erreur HTTP. Un refus du domaine garde son
 * statut et son détail : erreur HTTP déjà typée, schéma du domaine (400 avec le
 * champ), refus typé du framework (400 avec le champ), fournisseur (le statut
 * qui convient). Une panne ou un bug n'est pas maquillée en erreur du client :
 * elle remonte au serveur HTTP, qui la journalise et répond 500.
 */
export function domainToHttpError(error: unknown): HttpError {
  if (error instanceof ValidationException) return validationErrorOf(error);
  if (error instanceof HttpError || error instanceof ZodError || error instanceof ProviderError) return toHttpError(error);
  throw error;
}
