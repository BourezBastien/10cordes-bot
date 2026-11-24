/**
 * Le modèle a écrit ses JETONS INTERNES d'appel d'outil dans le texte
 * (`<｜DSML｜function_calls>`, `<tool_call>`...) au lieu d'un tool_call
 * structuré. Le tour est refusé : ce texte ne doit jamais atteindre Discord.
 */
export class LlmFormatLeakError extends Error {
  constructor(public readonly sample: string) {
    super('Le fournisseur IA a mélangé ses balises internes d\u0027appel d\u0027outil au texte.');
    this.name = 'LlmFormatLeakError';
  }
}
