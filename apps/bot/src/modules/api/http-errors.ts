import { BadRequestError, HttpError, NotFoundError, ServiceUnavailableError, UnprocessableEntityError, ValidationError } from '@spraxium/http';
import { ZodError, z } from 'zod';
import { ProviderError } from '../providers/provider.types';

/**
 * Erreurs des contrôleurs HTTP. Le framework ne connaît que ses `HttpError` :
 * toute autre erreur devient « Internal server error » (500). Les contrôleurs
 * valident leur corps de requête avec un schéma (400 avec le champ en cause)
 * et traduisent les erreurs du domaine en statut HTTP juste.
 */

type ValidationDetail = { property: string; constraints: Record<string, string> };

/** Détails de validation, tel que le framework les rend (`details` de la réponse 400). */
function toValidationDetails(error: ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    property: issue.path.join('.') || 'body',
    constraints: { message: issue.message },
  }));
}

/** Valide le corps d'une requête avec le schéma du contrat ; lève 400 avec le champ à corriger. */
export function parseBody<Schema extends z.ZodType>(schema: Schema, body: unknown): z.output<Schema> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ValidationError(toValidationDetails(parsed.error));
  return parsed.data;
}

/**
 * Erreur attrapée dans un contrôleur, en statut HTTP : une `HttpError` passe
 * (400 de validation, 403 de la garde), une erreur de fournisseur est
 * traduite, une erreur Zod du domaine devient 400, le reste rend `fallback`.
 */
export function toHttpError(error: unknown, fallback: HttpError = new BadRequestError('Requête invalide.')): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof ZodError) return new ValidationError(toValidationDetails(error));
  if (error instanceof ProviderError) return providerHttpError(error);
  return fallback;
}

/** Statut d'une erreur de fournisseur : une clé refusée est un réglage à corriger, pas une panne du serveur. */
export function providerHttpError(error: ProviderError): HttpError {
  const message = error.message.slice(0, 300);
  switch (error.kind) {
    case 'invalid':
    case 'unsupported':
    case 'auth':
    case 'quota':
      return new UnprocessableEntityError(message);
    case 'rate-limit':
    case 'unavailable':
    case 'timeout':
      return new ServiceUnavailableError(message);
    default:
      return new BadRequestError(message);
  }
}

/** Ressource inconnue sur CE serveur : même réponse qu'une route absente, sans révéler ce qui existe ailleurs. */
export function notFoundHere(): NotFoundError {
  return new NotFoundError('Not Found');
}
