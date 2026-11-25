import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  CapabilityBindSchema,
  CapabilityRouteViewSchema,
  ProviderCreateSchema,
  ProviderModelAddSchema,
  ProviderModelSchema,
  ProviderTestResultSchema,
  ProviderUpdateSchema,
  ProviderViewSchema,
  type CapabilityBind,
  type ProviderCreate,
  type ProviderModelAdd,
  type ProviderUpdate,
} from '@10cordes/shared';
import { guildPath } from '@/shell/guild-list';
import { api } from '@/lib/api';

/*
 * FOURNISSEURS ET CAPACITÉS : lectures et écritures. Toute écriture relit
 * les fournisseurs ; créer ou supprimer un fournisseur, lier une capacité,
 * relit aussi les capacités et l'accueil. Une suppression lit sa réponse
 * sans la contrôler : 204, ou un objet, peu importe.
 */

export const ProviderListSchema = z.object({ providers: z.array(ProviderViewSchema) });
/** Les routes d'une écriture reviennent en bloc : lier une capacité peut en faire suivre d'autres. */
export const CapabilityListSchema = z.object({ routes: z.array(CapabilityRouteViewSchema) });
const ProviderOneSchema = z.object({ provider: ProviderViewSchema });
const BindResultSchema = CapabilityListSchema.extend({ followedBy: z.array(z.string()) });
export const ModelListSchema = z.object({ models: z.array(ProviderModelSchema) });

const PROVIDERS = '/providers';
const CAPABILITIES = '/capabilities';
const ANY = z.unknown();

export function providerPath(guildId: string, providerId: string, suffix = ''): string {
  return guildPath(guildId, `${PROVIDERS}/${encodeURIComponent(providerId)}${suffix}`);
}

export function capabilityPath(guildId: string, capability: string): string {
  return guildPath(guildId, `${CAPABILITIES}/${encodeURIComponent(capability)}`);
}

export function useProviders(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'providers'],
    queryFn: () => api.get(guildPath(guildId, PROVIDERS), ProviderListSchema),
    // Un fournisseur en refroidissement : la carte compte, puis l'état se relit.
    refetchInterval: (query) =>
      query.state.data?.providers.some((provider) => provider.status.state === 'cooldown') ? 15_000 : false,
  });
}

export function useCapabilities(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'capabilities'],
    queryFn: () => api.get(guildPath(guildId, CAPABILITIES), CapabilityListSchema),
  });
}

export function useProviderModels(guildId: string, providerId: string | null) {
  return useQuery({
    queryKey: ['guild', guildId, 'providers', providerId, 'models'],
    queryFn: () => api.get(providerPath(guildId, providerId ?? '', '/models'), ModelListSchema),
    enabled: Boolean(providerId),
  });
}

export function useProviderMutations(guildId: string) {
  const queryClient = useQueryClient();
  const refresh = (scopes: string[]) => () => {
    for (const scope of scopes) void queryClient.invalidateQueries({ queryKey: ['guild', guildId, scope] });
  };
  const rewrite = refresh(['providers', 'capabilities', 'home']);
  return {
    create: useMutation({
      mutationFn: (body: ProviderCreate) => api.post(guildPath(guildId, PROVIDERS), ProviderCreateSchema.parse(body), ProviderOneSchema),
      onSuccess: rewrite,
    }),
    update: useMutation({
      mutationFn: ({ providerId, body }: { providerId: string; body: ProviderUpdate }) =>
        api.patch(providerPath(guildId, providerId), ProviderUpdateSchema.parse(body), ProviderOneSchema),
      onSuccess: rewrite,
    }),
    remove: useMutation({
      mutationFn: (providerId: string) => api.delete(providerPath(guildId, providerId), ANY),
      onSuccess: rewrite,
    }),
    test: useMutation({
      mutationFn: (providerId: string) => api.post(providerPath(guildId, providerId, '/test'), undefined, ProviderTestResultSchema),
      onSuccess: refresh(['providers']),
    }),
    addModel: useMutation({
      mutationFn: ({ providerId, body }: { providerId: string; body: ProviderModelAdd }) =>
        api.post(providerPath(guildId, providerId, '/models'), ProviderModelAddSchema.parse(body), ModelListSchema),
      onSuccess: refresh(['providers']),
    }),
  };
}

export type ProviderMutations = ReturnType<typeof useProviderMutations>;

export function useBindCapability(guildId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'capabilities'] }),
      queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'home'] }),
    ]);
  return {
    bind: useMutation({
      mutationFn: ({ capability, body }: { capability: string; body: CapabilityBind }) =>
        api.put(capabilityPath(guildId, capability), CapabilityBindSchema.parse(body), BindResultSchema),
      onSuccess: refresh,
    }),
    unbind: useMutation({
      mutationFn: (capability: string) => api.delete(capabilityPath(guildId, capability), ANY),
      onSuccess: refresh,
    }),
  };
}
