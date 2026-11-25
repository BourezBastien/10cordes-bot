import { useTranslation } from 'react-i18next';
import type { WebhookEndpointView, WebhookMethod } from '@10cordes/shared';
import { Badge, type Tone } from '@/ds/badge';
import { Button } from '@/ds/button';
import { DataTable, type TableColumn } from '@/ds/table';
import { useFormat } from '@/lib/format';

/*
 * TABLE DES CONNECTEURS (zone B). Nom et slug, méthode, URL cible (hôte et
 * chemin), type d'auth, dernier statut HTTP et dernier ping, et trois
 * actions : ping d'essai, édition, suppression. Les en-têtes secrets ne
 * montrent que leur nombre.
 */

export interface WebhooksTableProps {
  webhooks: ReadonlyArray<WebhookEndpointView>;
  /** Identifiant du connecteur dont le ping est en cours. */
  pinging: string | null;
  onPing: (webhook: WebhookEndpointView) => void;
  onEdit: (webhook: WebhookEndpointView) => void;
  onDelete: (webhook: WebhookEndpointView) => void;
}

const METHOD_TONE: Record<WebhookMethod, Tone> = { GET: 'info', POST: 'accent', PUT: 'warn', PATCH: 'skill', DELETE: 'danger' };

/** L'URL sans son protocole : l'hôte, puis le chemin et la requête. */
export function shortenUrl(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}` };
  } catch {
    return { host: url, path: '' };
  }
}

export function statusTone(status: number | null, error: string | null): Tone {
  if (status === null) return error ? 'danger' : 'neutral';
  return status >= 200 && status < 300 ? 'ok' : status >= 400 ? 'danger' : 'warn';
}

export function WebhooksTable({ webhooks, pinging, onPing, onEdit, onDelete }: WebhooksTableProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const columns: TableColumn<WebhookEndpointView>[] = [
    {
      key: 'name',
      header: t('integrations.webhooks.name'),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{row.name}</span>
          <span className="text-xs text-ink-faint">{row.slug}</span>
          {!row.enabled ? <span className="text-xs text-warn">{t('integrations.webhooks.disabled')}</span> : null}
        </span>
      ),
    },
    { key: 'method', header: t('integrations.webhooks.method'), cell: (row) => <Badge tone={METHOD_TONE[row.method]}>{row.method}</Badge> },
    {
      key: 'url',
      header: t('integrations.webhooks.url'),
      cell: (row) => {
        const { host, path } = shortenUrl(row.url);
        return (
          <span className="flex flex-col" title={row.url}>
            <span className="text-ink">{host}</span>
            <span className="max-w-72 truncate text-xs text-ink-faint">{path}</span>
          </span>
        );
      },
    },
    {
      key: 'auth',
      header: t('integrations.webhooks.auth'),
      cell: (row) => (
        <span className="flex flex-col gap-1">
          <span>{t(`integrations.webhooks.authTypes.${row.authType}`)}</span>
          <span className="text-xs text-ink-faint">{t('integrations.webhooks.secrets', { count: row.secretHeaderNames.length })}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t('integrations.webhooks.status'),
      cell: (row) => (
        <span className="flex flex-col gap-1" title={row.lastError ?? undefined}>
          <Badge tone={statusTone(row.lastHttpStatus, row.lastError)}>{row.lastHttpStatus ?? '·'}</Badge>
          <span className="text-xs text-ink-faint">
            {row.lastCheckedAt ? t('integrations.webhooks.lastPing', { when: format.ago(row.lastCheckedAt) }) : t('integrations.webhooks.never')}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <span className="flex justify-end gap-1">
          <Button size="chip" loading={pinging === row.webhookId} onClick={() => onPing(row)}>
            {t('integrations.webhooks.ping')}
          </Button>
          <Button size="chip" variant="ghost" onClick={() => onEdit(row)}>
            {t('providers.edit')}
          </Button>
          <Button size="chip" variant="ghost" className="text-danger-soft" onClick={() => onDelete(row)}>
            {t('providers.delete')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption={t('integrations.webhooks.caption')}
      rows={webhooks}
      keyOf={(row) => row.webhookId}
      columns={columns}
      empty={t('integrations.webhooks.empty')}
    />
  );
}
