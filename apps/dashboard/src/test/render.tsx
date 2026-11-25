import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { GuildProvider } from '@/shell/guild-context';
import type { GuildSummary } from '@/lib/schemas';

/*
 * OUTILS DES TESTS DE RENDU. Les pages se montent dans les mêmes fournisseurs
 * que dans l'application (requêtes, contexte du serveur). Le réseau est
 * remplacé par une table de routes : une route absente répond 404 comme le
 * bot, une route inattendue fait échouer le test.
 */

export const TEST_GUILD = '1550835980116824136';

export const TEST_GUILD_SUMMARY: GuildSummary = { id: TEST_GUILD, name: 'Serveur de test', icon: null, memberCount: 12 };

export function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <GuildProvider value={{ guildId: TEST_GUILD, guild: TEST_GUILD_SUMMARY, live: 'open' }}>{ui}</GuildProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function notFound(): Response {
  return jsonResponse({ ok: false, error: 'Not Found' }, 404);
}

type RouteHandler = (init: RequestInit | undefined) => Response | Promise<Response>;

export interface RouteTable {
  [methodAndPath: string]: RouteHandler;
}

/** Remplace fetch : chaque clé est « MÉTHODE chemin » (sans la chaîne de requête). */
export function stubRoutes(routes: RouteTable): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const handler = routes[`${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`];
    if (!handler) throw new Error(`Route non prévue dans le test : ${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Le chemin d'une route du serveur de test, tel que le dashboard l'écrit. */
export function guildPath(suffix: string): string {
  return `/api/v1/guilds/${TEST_GUILD}${suffix}`;
}
