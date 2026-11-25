import { z } from 'zod';
import { loginPath } from './return-path';

/*
 * CLIENT DE L'API. Même origine que le panneau (le proxy de Vite en
 * développement, le bot en production), cookies de session inclus. Chaque
 * réponse est vérifiée contre le schéma du contrat partagé : une réponse
 * qui n'y ressemble pas est une faute de l'API, signalée comme telle, jamais
 * affichée comme si elle était juste. Un 401 renvoie à la page de connexion.
 * Aucun en-tête Content-Type sur une requête sans corps.
 */

export interface ApiErrorDetail {
  property: string;
  constraints: Record<string, string>;
}

/** Erreur rendue par l'API : message, statut HTTP, champs en cause (400 de validation). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: ReadonlyArray<ApiErrorDetail> = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}

/** La réponse ne ressemble pas à ce que le contrat annonce. */
export class ShapeError extends Error {
  constructor(
    readonly path: string,
    readonly issues: ReadonlyArray<z.core.$ZodIssue>,
  ) {
    super(`Réponse inattendue de l'API (${path}).`);
    this.name = 'ShapeError';
  }
}

const errorBody = z.object({
  error: z.string().optional(),
  details: z
    .array(z.object({ property: z.string(), constraints: z.record(z.string(), z.string()) }))
    .optional(),
});

export const NO_CONTENT = z.undefined();

/** Ce que fait une réponse 401 : renvoyer à la page de connexion, qui ramènera à la page demandée. Isolé pour les tests. */
export const onUnauthorized = {
  redirect: () => {
    window.location.assign(loginPath(window.location.pathname + window.location.search));
  },
};

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init?.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch (cause) {
    throw new ApiError('Le serveur ne répond pas.', 0, [], { cause });
  }
  if (res.status === 401) onUnauthorized.redirect();
  const text = await res.text();
  let body: unknown = text;
  if (text && (res.headers.get('content-type') ?? '').includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      // Corps annoncé JSON et illisible : il servira tel quel au contrôle de forme.
    }
  }
  if (!res.ok) {
    const parsed = errorBody.safeParse(body);
    const details = parsed.success ? (parsed.data.details ?? []) : [];
    const message = parsed.success && parsed.data.error ? parsed.data.error : `HTTP ${res.status}`;
    throw new ApiError(message, res.status, details);
  }
  if (res.status === 204) return undefined as T;
  const result = schema.safeParse(body);
  if (!result.success) throw new ShapeError(path, result.error.issues);
  return result.data;
}

/** Un corps JSON, seulement quand il y en a un. */
function json(method: string, body: unknown): RequestInit {
  return body === undefined ? { method } : { method, body: JSON.stringify(body) };
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>) => request(path, schema),
  post: <T>(path: string, body: unknown, schema: z.ZodType<T>) => request(path, schema, json('POST', body)),
  put: <T>(path: string, body: unknown, schema: z.ZodType<T>) => request(path, schema, json('PUT', body)),
  patch: <T>(path: string, body: unknown, schema: z.ZodType<T>) => request(path, schema, json('PATCH', body)),
  delete: <T = void>(path: string, schema?: z.ZodType<T>) =>
    request<T>(path, (schema ?? NO_CONTENT) as unknown as z.ZodType<T>, { method: 'DELETE' }),
};

/** Message à montrer : le premier message de chaque champ en cause, sinon celui de l'erreur. */
export function errorMessage(error: unknown): string {
  if (error instanceof ShapeError) return error.message;
  if (error instanceof ApiError) {
    const fields = error.details.map((detail) => Object.values(detail.constraints)[0]).filter(Boolean);
    return fields.length > 0 ? fields.join(' / ') : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
