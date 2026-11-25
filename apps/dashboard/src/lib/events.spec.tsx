import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENT_SCOPES, useGuildEvents } from '@/lib/events';

/*
 * Flux temps réel : un événement ne dit que son type, et suffit à relire la
 * portée qu'il annonce. EventSource est remplacé par une classe que le test
 * pilote ; ce que le test observe, c'est la requête relue.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Set<EventListener>>();
  closed = false;
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type } as Event);
  }
}

const GUILD = '1550835980116824136';
const PROVIDERS_KEY = ['guild', GUILD, EVENT_SCOPES['provider.updated']];

describe('useGuildEvents', () => {
  afterEach(() => {
    FakeEventSource.instances = [];
    vi.unstubAllGlobals();
  });

  it('ouvre le flux du serveur, et un événement relit la portée qu\u0027il annonce', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const read = vi.fn(async () => 'lu');
    const onEvent = vi.fn((type: string) => void queryClient.invalidateQueries({ queryKey: ['guild', GUILD, EVENT_SCOPES[type as keyof typeof EVENT_SCOPES]] }));

    function Probe() {
      useGuildEvents(GUILD, onEvent);
      useQuery({ queryKey: PROVIDERS_KEY, queryFn: read });
      return null;
    }

    const view = render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
    const source = FakeEventSource.instances[0];
    expect(source?.url).toBe(`/api/v1/guilds/${GUILD}/events`);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    act(() => source?.emit('provider.updated'));
    expect(onEvent).toHaveBeenCalledWith('provider.updated');
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    // Un autre type relit une autre portée : celle des fournisseurs ne bouge pas.
    act(() => source?.emit('rules.updated'));
    expect(onEvent).toHaveBeenLastCalledWith('rules.updated');
    expect(read).toHaveBeenCalledTimes(2);

    act(() => view.unmount());
    expect(source?.closed).toBe(true);
  });

  it('chaque type d\u0027événement a sa portée', () => {
    expect(EVENT_SCOPES).toEqual({
      'provider.updated': 'providers',
      'capability.updated': 'capabilities',
      'integration.updated': 'integrations',
      'webhook.updated': 'webhooks',
      'rules.updated': 'rules',
    });
  });
});
