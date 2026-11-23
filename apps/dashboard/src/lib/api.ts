/** Client API : fetch JSON avec cookies, décodage de l'enveloppe d'erreur du bot. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: Array<{ property: string; constraints: Record<string, string> }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = typeof body === 'object' && body !== null ? body : {};
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status, err.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
};
