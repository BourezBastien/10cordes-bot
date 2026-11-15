/** Messages de bienvenue en attente d'une éventuelle suppression au départ du membre. */
export const pendingWelcomeMessages = new Map<string, string>();

export function welcomeCacheKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}
