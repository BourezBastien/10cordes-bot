/** Nombre de cadres gardés dans une pile journalisée. */
const DEFAULT_FRAMES = 6;
const FRAME_MAX_CHARS = 200;
const MESSAGE_MAX_CHARS = 180;
/** Profondeur maximale de la chaîne des causes. */
const CAUSE_MAX_DEPTH = 3;

/** Dossier courant, séparateurs toujours `/` : les cadres du projet s'écrivent par rapport à lui. */
const root = `${process.cwd().replaceAll('\\', '/')}/`;

/**
 * Un chemin absolu hors du dossier courant (dépendance) : ses deux derniers
 * segments suffisent à le reconnaître. Ancré au début de la localisation
 * (après `(` ou un espace), pour ne jamais mordre sur un chemin relatif.
 */
const ABSOLUTE_PATH_RE = /(?<=^|[ (])(?:[A-Za-z]:)?\/(?:[^()\s:]+\/)+([^()\s:]+)\/([^()\s:]+)(?=:)/gu;

/** L'erreur porte-t-elle une cause (erreur réseau de `fetch`, erreur enveloppée) ? */
function causeOf(error: Error): unknown {
  return 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
}

/**
 * Nature d'une erreur en une ligne : classe, message tronqué, puis la chaîne
 * de ses causes. `fetch` emboute la vraie raison (résolution DNS, refus de
 * connexion) dans sa cause : sans elle, le journal ne dit que « fetch failed ».
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth <= CAUSE_MAX_DEPTH && current instanceof Error; depth += 1) {
    parts.push(`${depth === 0 ? '' : 'causée par '}${current.name}: ${current.message}`.slice(0, MESSAGE_MAX_CHARS));
    current = causeOf(current);
  }
  return parts.length > 0 ? parts.join(' ; ') : String(error).slice(0, MESSAGE_MAX_CHARS);
}

/**
 * Une cadre, lisible et courte : séparateurs toujours `/`, quel que soit le
 * système (même écriture d'un journal à l'autre), chemin du projet relatif au
 * dossier courant, chemin d'une dépendance réduit à ses deux derniers segments.
 */
function shortenFrame(line: string): string {
  return line
    .replace(/^at\s+/u, '')
    .replaceAll('\\', '/')
    .replaceAll(root, '')
    // Les cadres des modules ES portent leur adresse (file:///...) : il ne reste que le chemin.
    .replaceAll('file:///', '')
    .replace(ABSOLUTE_PATH_RE, '.../$1/$2')
    .slice(0, FRAME_MAX_CHARS);
}

/**
 * Pile d'une erreur, tronquée pour le journal : les premières cadres (les
 * plus proches du point de lancement), chaque ligne courte, le tout sur une
 * seule ligne. Une erreur sans pile rend une chaîne vide.
 */
export function stackExcerpt(error: unknown, maxFrames = DEFAULT_FRAMES): string {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return '';
  return error.stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .map(shortenFrame)
    .slice(0, maxFrames)
    .join(' | ');
}
