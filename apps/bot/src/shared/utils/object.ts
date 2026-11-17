/** Fusion profonde de plain objects — les tableaux et scalaires remplacent. */
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/** Construit un patch imbriqué à partir d'un chemin pointé, ex: setPath('a.b', 1) → { a: { b: 1 } }. */
export function setPath(path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { [head]: value };
  return { [head]: setPath(rest.join('.'), value) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
