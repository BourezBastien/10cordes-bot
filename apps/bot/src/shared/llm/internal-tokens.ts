/**
 * Filtre de sécurité d'un flux de texte du modèle. Un fournisseur peut laisser
 * fuir ses JETONS INTERNES d'appel d'outil dans `content` au lieu d'un
 * `tool_call` structuré (DeepSeek et sa syntaxe DSML, Qwen, balises XML de
 * function calling). Du texte brut publié dans Discord est un incident : le
 * sanitizer ne laisse rien passer qui pourrait être le début d'une telle
 * balise, et signale la fuite pour que le tour soit rejeté.
 */

/** Ouvreuteur de jeton spécial : `<｜DSML｜...>`, `<｜tool▁calls▁begin｜>`, `<|tool_call|>`. */
const SPECIAL_OPENER_RE = /<[｜|]/u;

/** Balise XML d'appel d'outil, où qu'elle soit dans le texte. */
const TOOL_TAG_RE = /<\/?(?:tool_call|tool_calls|function_calls?|invoke)\b[^>]*>/iu;

/** Balise de paramètre : une fuite seulement à l'ouverture du texte (un extrait cité plus loin est légitime). */
const PARAMETER_TAG_AT_START_RE = /^\s*<\/?parameter\b[^>]*>/iu;

/** Queue pas encore publiable : `<`, `<｜`, `</`, ou le début d'un nom de balise. */
const PENDING_TAG_TAIL_RE = /(?:<[｜|]?|<\/?[a-zA-Z_]{0,40})$/u;

export class LlmStreamSanitizer {
  private pending = '';
  private leaked = false;
  private atStart = true;

  /** Une balise interne a été vue : le tour doit être rejeté, plus rien ne sort. */
  get didLeak(): boolean {
    return this.leaked;
  }

  /** Texte publiable d'un delta ; la queue suspecte est retenue jusqu'à levée du doute. */
  push(delta: string): string {
    if (this.leaked) return '';
    this.pending += delta;
    if (SPECIAL_OPENER_RE.test(this.pending) || TOOL_TAG_RE.test(this.pending) || (this.atStart && PARAMETER_TAG_AT_START_RE.test(this.pending))) {
      this.leaked = true;
      this.pending = '';
      return '';
    }
    const hold = this.pending.match(PENDING_TAG_TAIL_RE);
    if (hold) {
      const safe = this.pending.slice(0, hold.index);
      this.pending = hold[0];
      if (safe.trim()) this.atStart = false;
      return safe;
    }
    const safe = this.pending;
    this.pending = '';
    if (safe.trim()) this.atStart = false;
    return safe;
  }

  /** Fin du flux : une queue jamais fermée n'était pas une balise interne, on la relâche. */
  finish(): string {
    if (this.leaked) return '';
    const rest = this.pending;
    this.pending = '';
    return rest;
  }
}

/** Le texte contient-il un jeton interne, ou s'ouvre-t-il par une balise de paramètre ? */
export function containsInternalTokens(text: string): boolean {
  return SPECIAL_OPENER_RE.test(text) || TOOL_TAG_RE.test(text) || PARAMETER_TAG_AT_START_RE.test(text);
}

/** Retire les jetons spéciaux et l'espace qui les suit (tour conservé quand un vrai tool_call accompagne le texte). */
export function stripSpecialTokens(text: string): string {
  return text.replace(/<[｜|][^<>]{0,200}>\s*|<[｜|][^<>]{0,200}$/gu, '').trim();
}
