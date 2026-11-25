import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  IntegrationTestResultSchema,
  IntegrationUpdateSchema,
  IntegrationViewSchema,
  WebhookCreateSchema,
  WebhookEndpointViewSchema,
  WebhookPingResultSchema,
  WebhookUpdateSchema,
  type IntegrationUpdate,
  type WebhookCreate,
  type WebhookUpdate,
} from '@10cordes/shared';
import { guildPath } from '@/shell/guild-list';
import { api } from '@/lib/api';

/*
 * INTÉGRATIONS ET CONNECTEURS : lectures et écritures. Les jetons, clés et
 * en-têtes secrets partent chiffrés côté bot et ne reviennent jamais : une
 * valeur vide en mise à jour conserve celle d'avant.
 */

export const IntegrationListSchema = z.object({ integrations: z.array(IntegrationViewSchema) });
export const WebhookListSchema = z.object({ webhooks: z.array(WebhookEndpointViewSchema) });
const WebhookOneSchema = z.object({ webhook: WebhookEndpointViewSchema });

const ANY = z.unknown();
const IntegrationOneSchema = z.object({ integration: IntegrationViewSchema });

const integrationPath = (guildId: string, slug: string, suffix = '') =>
  guildPath(guildId, `/integrations/${encodeURIComponent(slug)}${suffix}`);
const webhookPath = (guildId: string, webhookId: string, suffix = '') =>
  guildPath(guildId, `/webhooks/${encodeURIComponent(webhookId)}${suffix}`);

export function useIntegrations(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'integrations'],
    queryFn: () => api.get(guildPath(guildId, '/integrations'), IntegrationListSchema),
  });
}

export function useIntegrationMutations(guildId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'integrations'] });
  return {
    update: useMutation({
      mutationFn: ({ slug, body }: { slug: string; body: IntegrationUpdate }) =>
        api.put(integrationPath(guildId, slug), IntegrationUpdateSchema.parse(body), IntegrationOneSchema),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (slug: string) => api.delete(integrationPath(guildId, slug), ANY),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: (slug: string) => api.post(integrationPath(guildId, slug, '/test'), undefined, IntegrationTestResultSchema),
      onSuccess: refresh,
    }),
  };
}

export type IntegrationMutations = ReturnType<typeof useIntegrationMutations>;

export function useWebhooks(guildId: string) {
  return useQuery({
    queryKey: ['guild', guildId, 'webhooks'],
    queryFn: () => api.get(guildPath(guildId, '/webhooks'), WebhookListSchema),
  });
}

export function useWebhookMutations(guildId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'webhooks'] });
  return {
    create: useMutation({
      mutationFn: (body: WebhookCreate) => api.post(guildPath(guildId, '/webhooks'), WebhookCreateSchema.parse(body), WebhookOneSchema),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ webhookId, body }: { webhookId: string; body: WebhookUpdate }) =>
        api.patch(webhookPath(guildId, webhookId), WebhookUpdateSchema.parse(body), WebhookOneSchema),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (webhookId: string) => api.delete(webhookPath(guildId, webhookId), ANY),
      onSuccess: refresh,
    }),
    ping: useMutation({
      mutationFn: (webhookId: string) => api.post(webhookPath(guildId, webhookId, '/ping'), undefined, WebhookPingResultSchema),
      onSuccess: refresh,
    }),
  };
}

export type WebhookMutations = ReturnType<typeof useWebhookMutations>;
