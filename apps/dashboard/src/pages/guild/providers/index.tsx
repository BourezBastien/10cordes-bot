import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ProviderTestResult, ProviderView } from '@10cordes/shared';
import { Button } from '@/ds/button';
import { CardList } from '@/ds/card-list';
import { ConfirmDialog } from '@/ds/confirm';
import { Empty, Section } from '@/ds';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { errorMessage } from '@/lib/api';
import { useProviderMutations, useProviders } from './api';
import { ModelCatalog } from './model-catalog';
import { ProviderCard } from './provider-card';
import { ProviderSheet, type ProviderSession } from './provider-sheet';
import { RouteMatrix } from './route-matrix';

/*
 * FOURNISSEURS IA ET MODÈLES. Trois zones : A, le registre des fournisseurs
 * (neuf cartes d'abord) ; B, le catalogue de modèles du fournisseur retenu
 * par le bouton « Modèles » ; C, la matrice de routage des capacités. Un
 * fournisseur en refroidissement se relit tout seul jusqu'au bout du compte
 * à rebours.
 */

export function ProvidersPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const providers = useProviders(guildId);
  const mutations = useProviderMutations(guildId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<ProviderSession | null>(null);
  const [deleting, setDeleting] = useState<ProviderView | null>(null);
  const [results, setResults] = useState<Record<string, ProviderTestResult>>({});

  const saving = mutations.create.isPending || mutations.update.isPending;
  const after = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      setSession(null);
      setDeleting(null);
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const runTest = (provider: ProviderView) =>
    mutations.test.mutate(provider.providerId, {
      onSuccess: (result) => setResults((prev) => ({ ...prev, [provider.providerId]: result })),
      onError: (error: unknown) =>
        setResults((prev) => ({
          ...prev,
          [provider.providerId]: { ok: false, summary: errorMessage(error), modelsFound: 0, status: provider.status },
        })),
    });

  const openCreate = () => setSession({ mode: 'create' });

  return (
    <Page>
      <GuildHeader
        title={t('providers.title')}
        description={t('providers.description')}
        actions={
          <Button variant="solid" onClick={openCreate}>
            {t('providers.add')}
          </Button>
        }
      />
      <QueryState query={providers} label={t('common.loading')}>
        {(data) => {
          const selected = data.providers.find((provider) => provider.providerId === selectedId) ?? (data.providers[0] ?? null);
          return (
            <>
              <Section index="A" title={t('providers.registry.title')} description={t('providers.registry.description')}>
                <CardList
                  items={data.providers}
                  keyOf={(provider) => provider.providerId}
                  moreLabel={t('common.showMore')}
                  empty={
                    <Empty
                      title={t('providers.emptyTitle')}
                      hint={t('providers.emptyHint')}
                      action={
                        <Button size="sm" variant="solid" onClick={openCreate}>
                          {t('providers.add')}
                        </Button>
                      }
                    />
                  }
                  render={(provider) => (
                    <ProviderCard
                      provider={provider}
                      selected={selected?.providerId === provider.providerId}
                      onSelect={() => setSelectedId(provider.providerId)}
                      testing={mutations.test.isPending && mutations.test.variables === provider.providerId}
                      onTest={() => runTest(provider)}
                      onEdit={() => setSession({ mode: 'edit', provider })}
                      onDelete={() => setDeleting(provider)}
                      result={results[provider.providerId]}
                    />
                  )}
                />
              </Section>
              <Section index="B" title={t('providers.catalog.title')} description={t('providers.catalog.description')}>
                <ModelCatalog
                  provider={selected}
                  adding={mutations.addModel.isPending}
                  onAdd={(modelId) => {
                    if (!selected) return;
                    mutations.addModel.mutate(
                      { providerId: selected.providerId, body: { modelId } },
                      {
                        onSuccess: () => toast.success(t('providers.modelsPage.added')),
                        onError: (error: unknown) => toast.error(errorMessage(error)),
                      },
                    );
                  }}
                />
              </Section>
              <Section index="C" title={t('providers.routes.title')} description={t('providers.routes.description')}>
                <RouteMatrix guildId={guildId} providers={data.providers} />
              </Section>
            </>
          );
        }}
      </QueryState>
      <ProviderSheet
        session={session}
        saving={saving}
        onClose={() => setSession(null)}
        onCreate={(body) => mutations.create.mutate(body, after(t('providers.created')))}
        onUpdate={(providerId, body) => mutations.update.mutate({ providerId, body }, after(t('providers.updated')))}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t('providers.deleteDialog.title')}
        message={deleting ? t('providers.deleteDialog.message', { name: deleting.displayName }) : ''}
        confirmLabel={t('providers.delete')}
        cancelLabel={t('common.cancel')}
        busy={mutations.remove.isPending}
        onConfirm={() => {
          if (deleting) mutations.remove.mutate(deleting.providerId, after(t('providers.deleted')));
        }}
      />
    </Page>
  );
}
