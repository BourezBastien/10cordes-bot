import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { IntegrationTestResult, IntegrationView, WebhookEndpointView, WebhookPingResult } from '@10cordes/shared';
import { Button } from '@/ds/button';
import { CardList } from '@/ds/card-list';
import { ConfirmDialog } from '@/ds/confirm';
import { Empty, Section } from '@/ds';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { errorMessage } from '@/lib/api';
import { useIntegrationMutations, useIntegrations, useWebhookMutations, useWebhooks } from './api';
import { KeySheet } from './key-sheet';
import { ServiceCard } from './service-card';
import { WebhookSheet, type WebhookSession } from './webhook-sheet';
import { WebhooksTable } from './webhooks-table';

/*
 * INTÉGRATIONS. Zone A : les services spécialisés (PixelLab et les suivants),
 * leur clé, leur activation, l'accès à tester. Zone B : les connecteurs HTTP
 * sortants, avec leur ping d'essai. Aucune clé ni aucun en-tête secret ne
 * s'affiche un jour : un statut, un nombre.
 */

export function IntegrationsPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const integrations = useIntegrations(guildId);
  const integration = useIntegrationMutations(guildId);
  const webhooks = useWebhooks(guildId);
  const webhook = useWebhookMutations(guildId);
  const [keyService, setKeyService] = useState<IntegrationView | null>(null);
  const [connector, setConnector] = useState<WebhookSession | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpointView | null>(null);
  const [results, setResults] = useState<Record<string, IntegrationTestResult | WebhookPingResult>>({});

  const report = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      setKeyService(null);
      setConnector(null);
      setDeleting(null);
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  return (
    <Page>
      <GuildHeader title={t('integrations.title')} description={t('integrations.description')} />
      <Section index="A" title={t('integrations.services.title')} description={t('integrations.services.description')}>
        <QueryState query={integrations} label={t('common.loading')}>
          {(data) => (
            <CardList
              items={data.integrations}
              keyOf={(service) => service.slug}
              moreLabel={t('common.showMore')}
              empty={<Empty title={t('common.empty')} />}
              render={(service) => (
                <ServiceCard
                  service={service}
                  testing={integration.test.isPending && integration.test.variables === service.slug}
                  busy={integration.update.isPending || integration.remove.isPending}
                  result={results[service.slug]}
                  onToggle={(enabled) =>
                    integration.update.mutate(
                      { slug: service.slug, body: { enabled } },
                      {
                        onSuccess: () => toast.success(t('common.saved')),
                        onError: (error: unknown) => toast.error(errorMessage(error)),
                      },
                    )
                  }
                  onConfigure={() => setKeyService(service)}
                  onTest={() =>
                    integration.test.mutate(service.slug, {
                      onSuccess: (result) => setResults((prev) => ({ ...prev, [service.slug]: result })),
                      onError: (error: unknown) => setResults((prev) => ({ ...prev, [service.slug]: { ok: false, summary: errorMessage(error), status: null, ms: 0 } })),
                    })
                  }
                />
              )}
            />
          )}
        </QueryState>
      </Section>
      <Section
        index="B"
        title={t('integrations.webhooks.title')}
        description={t('integrations.webhooks.description')}
        actions={
          <Button variant="solid" onClick={() => setConnector({ mode: 'create' })}>
            {t('integrations.webhooks.add')}
          </Button>
        }
      >
        <QueryState query={webhooks} label={t('common.loading')}>
          {(data) => (
            <WebhooksTable
              webhooks={data.webhooks}
              pinging={webhook.ping.isPending ? (webhook.ping.variables ?? null) : null}
              onPing={(row) =>
                webhook.ping.mutate(row.webhookId, {
                  onSuccess: (result) =>
                    result.ok ? toast.success(t('integrations.webhooks.pingResult.ok', { status: result.status ?? '·', ms: result.ms })) : toast.error(t('integrations.webhooks.pingResult.failed', { message: result.summary })),
                  onError: (error: unknown) => toast.error(errorMessage(error)),
                })
              }
              onEdit={(row) => setConnector({ mode: 'edit', webhook: row })}
              onDelete={(row) => setDeleting(row)}
            />
          )}
        </QueryState>
      </Section>

      <KeySheet
        service={keyService}
        saving={integration.update.isPending || integration.remove.isPending}
        onClose={() => setKeyService(null)}
        onSave={(body) => keyService && integration.update.mutate({ slug: keyService.slug, body }, report(t('integrations.keySheet.saved')))}
        onRemove={() => keyService && integration.remove.mutate(keyService.slug, report(t('integrations.keySheet.removed')))}
      />
      <WebhookSheet
        session={connector}
        saving={webhook.create.isPending || webhook.update.isPending}
        onClose={() => setConnector(null)}
        onCreate={(body) => webhook.create.mutate(body, report(t('integrations.webhooks.created')))}
        onUpdate={(webhookId, body) => webhook.update.mutate({ webhookId, body }, report(t('integrations.webhooks.updated')))}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t('integrations.webhooks.deleteDialog.title')}
        message={deleting ? t('integrations.webhooks.deleteDialog.message', { name: deleting.name }) : ''}
        confirmLabel={t('providers.delete')}
        cancelLabel={t('common.cancel')}
        busy={webhook.remove.isPending}
        onConfirm={() => {
          if (deleting) webhook.remove.mutate(deleting.webhookId, report(t('integrations.webhooks.deleted')));
        }}
      />
    </Page>
  );
}
