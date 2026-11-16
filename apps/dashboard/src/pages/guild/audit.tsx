import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from '@tanstack/react-router';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  metadata: string;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  page: number;
  pages: number;
  total: number;
}

export function AuditPage() {
  const { t } = useTranslation();
  const { guildId } = useParams({ from: '/g/$guildId' });
  const [page, setPage] = useState(1);

  const auditQuery = useQuery({
    queryKey: ['guild', guildId, 'audit', page],
    queryFn: () => api.get<AuditResponse>(`/api/v1/guilds/${guildId}/audit?page=${page}`),
  });

  const data = auditQuery.data;

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('nav.audit')}</h1>
        <span className="text-sm text-ink-muted">
          {data ? `${data.total} ${t('audit.entries')}` : ''}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-ink-muted">
            <tr>
              <th className="px-4 py-2 font-medium">{t('audit.date')}</th>
              <th className="px-4 py-2 font-medium">{t('audit.action')}</th>
              <th className="px-4 py-2 font-medium">{t('audit.actor')}</th>
              <th className="px-4 py-2 font-medium">{t('audit.details')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.entries ?? []).map((entry) => (
              <tr key={entry.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                <td className="px-4 py-2 font-mono text-xs">{entry.actorId ?? 'system'}</td>
                <td className="max-w-64 truncate px-4 py-2 text-xs text-ink-muted">{entry.metadata}</td>
              </tr>
            ))}
            {data && data.entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                  {t('audit.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          {t('audit.prev')}
        </Button>
        <span className="text-sm text-ink-muted">
          {data ? `${data.page} / ${data.pages}` : ''}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(data) && page >= (data?.pages ?? 1)}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('audit.next')}
        </Button>
      </div>
    </div>
  );
}
