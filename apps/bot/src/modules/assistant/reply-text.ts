/**
 * Mise en forme du texte de la conversation : transcription sûre du salon
 * pour le prompt, et découpage des réponses longues.
 */

/** Neutralise les crochets dans un contenu utilisateur : impossible de forger une étiquette de transcript. */
export function sanitizeTranscriptLine(content: string): string {
  return content.replace(/\[/g, '［').replace(/\]/g, '］');
}

/** Découpe une réponse en morceaux de 1200 caractères (marge sous la limite Discord de 2000). */
export function splitReplyChunks(content: string): string[] {
  const chunks: string[] = [];
  let rest = content;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, 1200));
    rest = rest.slice(1200);
  }
  return chunks;
}
