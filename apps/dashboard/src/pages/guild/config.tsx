import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONFIG_KEYS, type ConfigKeyDescriptor } from '@10cordes/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useParams } from '@tanstack/react-router';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

type GuildConfigDoc = Record<string, unknown>;

interface ChannelLite {
  id: string;
  name: string;
  type: number;
}
interface RoleLite {
  id: string;
  name: string;
  color: number;
}

function getPath(doc: GuildConfigDoc, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), doc);
}

function setIn(patch: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let node = patch;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!node[keys[i]] || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
    node = node[keys[i]] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

function ConfigField({
  descriptor,
  value,
  channels,
  roles,
  onChange,
}: {
  descriptor: ConfigKeyDescriptor;
  value: unknown;
  channels: ChannelLite[];
  roles: RoleLite[];
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  switch (descriptor.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm">{descriptor.description}</span>
        </label>
      );
    case 'number':
      return (
        <div className="flex flex-col gap-1">
          <Label>{descriptor.description}</Label>
          <Input
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      );
    case 'channel':
      return (
        <div className="flex flex-col gap-1">
          <Label>{descriptor.description}</Label>
          <select
            className="h-9 w-full rounded-md border border-line bg-canvas px-3 text-sm text-ink"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">({t('common.none')})</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </div>
      );
    case 'role':
      return (
        <div className="flex flex-col gap-1">
          <Label>{descriptor.description}</Label>
          <select
            className="h-9 w-full rounded-md border border-line bg-canvas px-3 text-sm text-ink"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">({t('common.none')})</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                @{role.name}
              </option>
            ))}
          </select>
        </div>
      );
    case 'locale':
      return (
        <div className="flex flex-col gap-1">
          <Label>{descriptor.description}</Label>
          <select
            className="h-9 w-full rounded-md border border-line bg-canvas px-3 text-sm text-ink"
            value={typeof value === 'string' ? value : 'fr'}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-1">
          <Label>{descriptor.description}</Label>
          <Input value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}

export function ConfigPage() {
  const { t } = useTranslation();
  const { guildId } = useParams({ from: '/g/$guildId' });
  const queryClient = useQueryClient();
  const [patch, setPatch] = useState<Record<string, unknown>>({});

  const configQuery = useQuery({
    queryKey: ['guild', guildId, 'config'],
    queryFn: () => api.get<GuildConfigDoc>(`/api/v1/guilds/${guildId}/config`),
  });
  const channelsQuery = useQuery({
    queryKey: ['guild', guildId, 'channels'],
    queryFn: () => api.get<{ channels: ChannelLite[] }>(`/api/v1/guilds/${guildId}/channels`),
    staleTime: 5 * 60_000,
  });
  const rolesQuery = useQuery({
    queryKey: ['guild', guildId, 'roles'],
    queryFn: () => api.get<{ roles: RoleLite[] }>(`/api/v1/guilds/${guildId}/roles`),
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/api/v1/guilds/${guildId}/config`, data),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setPatch({});
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'config'] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.details) {
        for (const detail of error.details) {
          toast.error(`${detail.property} : ${Object.values(detail.constraints)[0]}`);
        }
      } else {
        toast.error(t('common.error'));
      }
    },
  });

  const channels = channelsQuery.data?.channels ?? [];
  const roles = rolesQuery.data?.roles ?? [];
  const doc = configQuery.data ?? {};

  const update = (descriptor: ConfigKeyDescriptor, value: unknown) => {
    setIn(patch, descriptor.path, value);
    setPatch({ ...patch });
  };

  const save = () => {
    if (Object.keys(patch).length === 0) {
      toast.info(t('common.noChanges'));
      return;
    }
    saveMutation.mutate(patch);
  };

  const groups = new Map<string, ConfigKeyDescriptor[]>();
  for (const key of CONFIG_KEYS) {
    const group = key.path.split('.')[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)?.push(key);
  }

  if (configQuery.isPending) {
    return <div className="p-8 text-ink-muted">{t('common.loading')}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('nav.config')}</h1>
        <Button onClick={save} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? '…' : t('common.save')}
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        {[...groups.entries()].map(([group, keys]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="capitalize">{group}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {keys.map((key) => (
                <ConfigField
                  key={key.path}
                  descriptor={key}
                  value={patchHas(patch, key.path) ? getPath(patch, key.path) : getPath(doc, key.path)}
                  channels={channels}
                  roles={roles}
                  onChange={(value) => update(key, value)}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function patchHas(patch: Record<string, unknown>, path: string): boolean {
  return getPath(patch, path) !== undefined;
}
