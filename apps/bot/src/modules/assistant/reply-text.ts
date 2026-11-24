/**
 * Mise en forme du texte de la conversation : transcription sûre du salon
 * pour le prompt. Le découpage des réponses longues vit dans
 * `shared/utils/message-split.ts`.
 */

/** Neutralise les crochets dans un contenu utilisateur : impossible de forger une étiquette de transcript. */
export function sanitizeTranscriptLine(content: string): string {
  return content.replace(/\[/g, '［').replace(/\]/g, '］');
}
