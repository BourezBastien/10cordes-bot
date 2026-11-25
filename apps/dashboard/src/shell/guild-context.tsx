import { createContext, useContext, type ReactNode } from 'react';
import type { GuildSummary } from '@/lib/schemas';
import type { LiveState } from '@/lib/events';

/*
 * CONTEXTE DU SERVEUR. La coque d'un serveur (layout de route) y pose ce
 * que chaque page affiche : l'identifiant de la route, la fiche du serveur
 * quand l'API l'a rendue, et l'état du flux temps réel.
 */

export interface GuildContextValue {
  guildId: string;
  guild: GuildSummary | null;
  live: LiveState;
}

const GuildContext = createContext<GuildContextValue | null>(null);

export function GuildProvider({ value, children }: { value: GuildContextValue; children: ReactNode }) {
  return <GuildContext.Provider value={value}>{children}</GuildContext.Provider>;
}

export function useGuild(): GuildContextValue {
  const value = useContext(GuildContext);
  if (!value) throw new Error('useGuild() s’utilise dans une page de serveur.');
  return value;
}
