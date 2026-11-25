import { useEffect, useRef, useState } from 'react';
import { DASHBOARD_EVENT_TYPES } from '@10cordes/shared';

export type DashboardEventType = (typeof DASHBOARD_EVENT_TYPES)[number];

/** Clés de requêtes à relire quand un type d'événement arrive. */
export const EVENT_SCOPES: Record<DashboardEventType, string> = {
  'provider.updated': 'providers',
  'capability.updated': 'capabilities',
  'integration.updated': 'integrations',
  'webhook.updated': 'webhooks',
  'rules.updated': 'rules',
};

export type LiveState = 'off' | 'connecting' | 'open' | 'error';

export function eventsPath(guildId: string): string {
  return `/api/v1/guilds/${encodeURIComponent(guildId)}/events`;
}

/**
 * Flux temps réel d'un serveur. Le navigateur rouvre seul une connexion
 * coupée (EventSource). Un événement ne dit que son type : il suffit à
 * relire. Renvoie l'état de la connexion, pour un témoin dans la coque.
 */
export function useGuildEvents(
  guildId: string,
  onEvent: (type: DashboardEventType) => void,
  enabled = true,
): LiveState {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [state, setState] = useState<LiveState>('off');

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    setState('connecting');
    const source = new EventSource(eventsPath(guildId));
    const onOpen = () => setState('open');
    const onError = () => setState(source.readyState === EventSource.CLOSED ? 'error' : 'connecting');
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);
    const listeners = DASHBOARD_EVENT_TYPES.map((type) => {
      const listener = () => handler.current(type);
      source.addEventListener(type, listener);
      return listener;
    });
    return () => {
      listeners.forEach((listener, index) => {
        source.removeEventListener(DASHBOARD_EVENT_TYPES[index] ?? '', listener);
      });
      source.removeEventListener('open', onOpen);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [guildId, enabled]);

  return enabled ? state : 'off';
}
