/**
 * Détection de langue heuristique : le prompt système dit de répondre dans la
 * langue du message, la valeur sert aussi aux formats de date/heure.
 * FR par défaut (base historique du bot), sinon détection par indices simples.
 */
export function detectLocale(text: string): string {
  const sample = text.toLowerCase().slice(0, 400);
  // Indices forts anglais
  const englishHits = (sample.match(/\b(the|you|your|what|how|please|thanks|can|make|create|about)\b/g) ?? []).length;
  // Indices forts français (accents inclus)
  const frenchHits = (sample.match(/\b(le|la|les|tu|ton|tes|quoi|comment|merci|peux|crée|avec|pour|est|pas|sur)\b|[éèêàçù]/g) ?? []).length;
  if (englishHits >= 2 && englishHits > frenchHits) return 'en';
  return 'fr';
}
