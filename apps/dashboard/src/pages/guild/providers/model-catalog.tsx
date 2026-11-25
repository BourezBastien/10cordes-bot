import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MODEL_ID_MAX, type ProviderModel, type ProviderView } from '@10cordes/shared';
import { Badge } from '@/ds/badge';
import { Button } from '@/ds/button';
import { DataTable, type TableColumn } from '@/ds/table';
import { Empty, Panel } from '@/ds';
import { Field, Input } from '@/ds/field';
import { useFormat } from '@/lib/format';
import { BADGE_TONE, kindBadges } from './labels';

/*
 * CATALOGUE DE MODÈLES (zone B). Les modèles du fournisseur retenu dans le
 * registre : ceux que le test de connexion a découverts, et les slugs
 * ajoutés à la main (badge Découvert ou Manuel), avec leurs types, leur
 * fenêtre de contexte et leur sortie maximale quand le catalogue les donne.
 * Sous le tableau, un champ enregistre un slug à la main.
 */

export interface ModelCatalogProps {
  provider: ProviderView | null;
  adding: boolean;
  onAdd: (modelId: string) => void;
}

function ModelCell({ model }: { model: ProviderModel }) {
  return (
    <span className="flex flex-col">
      <span className="break-all text-ink">{model.id}</span>
      {model.name ? <span className="text-xs text-ink-faint">{model.name}</span> : null}
    </span>
  );
}

export function ModelCatalog({ provider, adding, onAdd }: ModelCatalogProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  const columns: TableColumn<ProviderModel>[] = [
    { key: 'id', header: t('providers.modelsPage.slug'), cell: (row) => <ModelCell model={row} /> },
    {
      key: 'kinds',
      header: t('providers.catalog.title'),
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {kindBadges(row).map((badge) => (
            <Badge key={badge} tone={BADGE_TONE[badge]}>
              {t(`providers.kind.${badge}`)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'context',
      header: t('providers.modelsPage.context'),
      className: 'text-right tabular-nums',
      cell: (row) => (row.contextWindow ? format.compact(row.contextWindow) : '·'),
    },
    {
      key: 'output',
      header: t('providers.modelsPage.maxOutput'),
      className: 'text-right tabular-nums',
      cell: (row) => (row.maxOutput ? format.compact(row.maxOutput) : '·'),
    },
    {
      key: 'origin',
      header: t('providers.modelsPage.originLabel'),
      cell: (row) => <Badge tone={row.origin === 'discovered' ? 'info' : 'neutral'}>{t(`providers.modelsPage.origin.${row.origin}`)}</Badge>,
    },
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = slug.trim();
    if (!value || value.length > MODEL_ID_MAX) {
      setError(t('providers.sheet.slugInvalid'));
      return;
    }
    setError(null);
    setSlug('');
    onAdd(value);
  };

  if (!provider) {
    return (
      <Panel title={t('providers.catalog.title')}>
        <Empty title={t('providers.catalog.pick')} glyph="▤" />
      </Panel>
    );
  }

  const discovered = provider.models.filter((model) => model.origin === 'discovered').length;

  return (
    <Panel
      title={t('providers.modelsPage.title', { name: provider.displayName })}
      label={`${t('providers.modelsPage.discovered')} ${discovered} · ${t('providers.modelsPage.total')} ${provider.models.length}`}
    >
      <DataTable
        caption={t('providers.modelsPage.title', { name: provider.displayName })}
        rows={provider.models}
        keyOf={(row) => row.id}
        columns={columns}
        empty={t('providers.modelsPage.empty')}
      />
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-start gap-2 border-t border-line pt-4">
        <Field label={t('providers.modelsPage.add')} hint={t('providers.modelsPage.slugHint')} error={error ?? undefined} className="min-w-64 flex-1">
          {(control) => (
            <Input
              {...control}
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
                setError(null);
              }}
              placeholder={t('providers.modelsPage.slug')}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
        <Button variant="solid" type="submit" loading={adding} className="mt-7">
          {t('common.add')}
        </Button>
      </form>
    </Panel>
  );
}
