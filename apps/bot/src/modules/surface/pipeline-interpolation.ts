import type { PipelineVars } from './pipeline.types';

/**
 * Interpolation des variables d'un pipeline ({{actor.id}}, {{state.x}},
 * {{steps.n.field}}, {{modal.x}}, {{value.x}}, {{event.x}}) et écriture dans
 * l'état (setState : set / increment / decrement / toggle). Classe pure,
 * aussi utilisée par le rendu des surfaces pour afficher l'état en direct.
 */
export class PipelineInterpolator {
  /** Valeur TYPÉE d'un chemin de variable (`state.x`, `steps.n.field`...) : chaîne vide si inconnu. */
  resolveReference(path: string, vars: PipelineVars): unknown {
    if (path === 'actor.id') return vars.actorId;
    if (path === 'actor.username') return vars.actorName;
    if (path === 'guild.id') return vars.guildId;
    if (path === 'surface.channelId') return vars.channelId;
    if (path === 'surface.messageId') return vars.messageId ?? '';
    if (path.startsWith('state.')) return this.readPath(vars.state, path.slice(6)) ?? '';
    if (path.startsWith('steps.')) {
      const [index, field] = path.slice(6).split('.');
      const step = vars.steps[Number(index)];
      return step ? (step[field ?? ''] ?? '') : '';
    }
    if (path.startsWith('modal.')) return vars.modalValues?.[path.slice(6)] ?? '';
    if (path.startsWith('value.')) return vars.values[path.slice(6)] ?? '';
    if (path.startsWith('event.')) return this.readPath(vars.event ?? {}, path.slice(6)) ?? '';
    return '';
  }

  /** Valeur lisible dans un texte : un tableau ou un objet ne s'affiche jamais en `[object Object]`. */
  display(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && !value.some((item) => typeof item === 'object' && item !== null)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value) ?? '';
    return String(value);
  }

  /** Remplace chaque {{chemin}} par sa valeur (chaîne vide si inconnue). */
  interpolate(text: string, vars: PipelineVars): string {
    return text.replace(/\{\{([^}]+)\}\}/gu, (_match, rawPath: string) => this.display(this.resolveReference(rawPath.trim(), vars)));
  }

  /** Interpole récursivement les chaînes d'une valeur (objet, tableau, scalaire). */
  deepInterpolate(value: unknown, vars: PipelineVars): unknown {
    if (typeof value === 'string') return this.interpolate(value, vars);
    if (Array.isArray(value)) return value.map((item) => this.deepInterpolate(item, vars));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = this.deepInterpolate(item, vars);
      return out;
    }
    return value;
  }

  /**
   * Valeur à écrire dans l'état (setState) : une référence UNIQUE `{{chemin}}`
   * garde le type de sa cible (le tirage d'un random, le JSON d'une étape
   * llm), un texte mélangé est interpolé, le reste est inchangé.
   */
  resolveValue(value: unknown, vars: PipelineVars): unknown {
    if (typeof value !== 'string') return value;
    const reference = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/u);
    if (reference) return this.resolveReference(reference[1] ?? '', vars);
    return value.includes('{{') ? this.interpolate(value, vars) : value;
  }

  /** Valeur d'un chemin pointé dans un objet (undefined si une étape manque). */
  readPath(source: Record<string, unknown>, dotted: string): unknown {
    return dotted.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source);
  }

  /** Chaîne « vraie », « fausse » ou numérique ramenée à son type. */
  coerce(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(\.\d+)?$/u.test(value)) return Number(value);
    return value;
  }

  /**
   * JSON tolérant d'une réponse de modèle : le premier bloc objet ou tableau
   * est extrait s'il est noyé dans du texte ; sans JSON valable, le texte brut.
   */
  parseJsonLenient(text: string): unknown {
    const trimmed = text.trim();
    const candidates = [trimmed, trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/u)?.[0] ?? ''];
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        /* essai suivant */
      }
    }
    return text;
  }

  /** Écrit une valeur dans l'état par chemin pointé (crée les intermédiaires manquants). */
  setPath(state: Record<string, unknown>, dotted: string, value: unknown, mode: 'set' | 'increment' | 'decrement' | 'toggle'): void {
    const keys = dotted.split('.');
    let cursor: Record<string, unknown> = state;
    for (const key of keys.slice(0, -1)) {
      if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1];
    const current = cursor[last];
    if (mode === 'increment') cursor[last] = Number(current ?? 0) + Number(value ?? 1);
    else if (mode === 'decrement') cursor[last] = Number(current ?? 0) - Number(value ?? 1);
    else if (mode === 'toggle') cursor[last] = !current;
    else cursor[last] = value ?? null;
  }
}
