import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from '@tanstack/react-router';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface GuildMemoryEntry {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
}

interface MemberMemoryEntry extends GuildMemoryEntry {
  userId: string;
}

export function MemoriesPage() {
  const { t } = useTranslation();
  const { guildId } = useParams({ from: '/g/$guildId' });

  const memoriesQuery = useQuery({
    queryKey: ['guild', guildId, 'memories'],
    queryFn: () =>
      api.get<{ guild: GuildMemoryEntry[]; members: MemberMemoryEntry[] }>(`/api/v1/guilds/${guildId}/memories`),
  });

  const guild = memoriesQuery.data?.guild ?? [];
  const members = memoriesQuery.data?.members ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">{t('nav.memories')}</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('memories.guild')} ({guild.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {guild.length === 0 ? <p className="text-sm text-ink-muted">{t('memories.empty')}</p> : null}
          {guild.map((entry) => (
            <div key={entry.id} className="rounded-md border border-line bg-canvas px-3 py-2">
              <div className="flex items-center justify-between text-xs text-ink-muted">
                <span className="font-mono">{entry.kind}</span>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-sm">{entry.content}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('memories.members')} ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {members.length === 0 ? <p className="text-sm text-ink-muted">{t('memories.empty')}</p> : null}
          {members.map((entry) => (
            <div key={entry.id} className="rounded-md border border-line bg-canvas px-3 py-2">
              <div className="flex items-center justify-between text-xs text-ink-muted">
                <span>
                  <span className="font-mono">{entry.userId}</span> · {entry.kind}
                </span>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-sm">{entry.content}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
