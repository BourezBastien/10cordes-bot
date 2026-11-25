import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CONFIG_KEYS, type ConfigKeyDescriptor } from '@10cordes/shared';
import { Button } from '@/ds/button';
import { Checkbox, Field, Input, Textarea } from '@/ds/field';
import { Empty } from '@/ds/kpi';
import { Select, type SelectOption } from '@/ds/select';
import { Tabs, type TabItem } from '@/ds/tabs';
import { guildPath } from '@/shell/guild-list';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useChannels, useConfig, useRoles } from '@/lib/queries';
import { ConfigDocumentSchema, type ChannelLite, type RoleLite } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/*
 * CONFIGURATION. Les réglages du serveur, champ par champ, un onglet par
 * groupe. Les changements se cumulent (barre d'accent à gauche du champ
 * modifié) et s'enregistrent ensemble, ou s'abandonnent.
 */

type Doc = Record<string, unknown>;
type Errors = Record<string, string>;

const NONE = '__none__';
const CATEGORY = 4;

function getPath(doc: Doc, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Doc)[key] : undefined), doc);
}

/** Copie du document où `path` vaut `value` : les niveaux intermédiaires naissent au besoin. */
function setPath(doc: Doc, path: string, value: unknown): Doc {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...doc, [head]: value };
  const child = doc[head] && typeof doc[head] === 'object' ? (doc[head] as Doc) : {};
  return { ...doc, [head]: setPath(child, rest.join('.'), value) };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface ControlProps {
  descriptor: ConfigKeyDescriptor;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  options: SelectOption<string>[];
}

function Control({ descriptor, value, error, onChange, options }: ControlProps) {
  const label = descriptor.description;
  switch (descriptor.type) {
    case 'boolean':
      return (
        <div className="flex flex-col gap-1">
          <Checkbox checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} label={label} />
          {error ? <p role="alert" className="text-xs text-danger-soft">{error}</p> : null}
        </div>
      );
    case 'number':
      return (
        <Field label={label} error={error}>
          {(control) => (
            <Input
              {...control}
              type="number"
              value={typeof value === 'number' ? String(value) : ''}
              onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
            />
          )}
        </Field>
      );
    case 'channel':
    case 'role':
    case 'locale':
      return (
        <Field label={label} error={error}>
          {(control) => (
            <Select
              {...control}
              value={typeof value === 'string' && value !== '' ? value : NONE}
              options={options}
              onChange={(next) => onChange(next === NONE ? '' : next)}
            />
          )}
        </Field>
      );
    default:
      return descriptor.path.endsWith('.template') ? (
        <Field label={label} error={error}>
          {(control) => <Textarea {...control} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />}
        </Field>
      ) : (
        <Field label={label} error={error}>
          {(control) => <Input {...control} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />}
        </Field>
      );
  }
}

function optionsFor(descriptor: ConfigKeyDescriptor, channels: ReadonlyArray<ChannelLite>, roles: ReadonlyArray<RoleLite>, none: string): SelectOption<string>[] {
  const empty: SelectOption<string> = { value: NONE, label: none };
  if (descriptor.type === 'channel') {
    return [empty, ...channels.map((channel) => ({ value: channel.id, label: channel.type === CATEGORY ? `▣ ${channel.name}` : `# ${channel.name}` }))];
  }
  if (descriptor.type === 'role') {
    return [empty, ...roles.map((role) => ({ value: role.id, label: `@ ${role.name}` }))];
  }
  if (descriptor.type === 'locale') {
    return [
      { value: 'fr', label: 'Français' },
      { value: 'en', label: 'English' },
    ];
  }
  return [];
}

function Changed({ changed, children }: { changed: boolean; children: ReactNode }) {
  return <div className={cn('flex flex-col gap-1', changed && 'bar-accent pl-3')}>{children}</div>;
}

export function ConfigPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const [patch, setPatch] = useState<Doc>({});
  const [errors, setErrors] = useState<Errors>({});
  const [group, setGroup] = useState('');

  const config = useConfig(guildId);
  const channels = useChannels(guildId);
  const roles = useRoles(guildId);

  const save = useMutation({
    mutationFn: (data: Doc) => api.patch(guildPath(guildId, '/config'), data, ConfigDocumentSchema),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setPatch({});
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'config'] });
    },
    onError: (error: unknown) => {
      const next: Errors = {};
      if (error instanceof ApiError) {
        for (const detail of error.details) {
          next[detail.property] = Object.values(detail.constraints)[0] ?? '';
        }
      }
      setErrors(next);
      toast.error(errorMessage(error));
    },
  });

  const update = (descriptor: ConfigKeyDescriptor, value: unknown) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[descriptor.path];
      return next;
    });
    setPatch((prev) => setPath(prev, descriptor.path, value));
  };

  const changed = Object.keys(patch).length;

  return (
    <Page>
      <GuildHeader
        title={t('config.title')}
        description={t('config.description')}
        actions={
          <>
            <Button variant="ghost" disabled={save.isPending || changed === 0} onClick={() => { setPatch({}); setErrors({}); }}>
              {t('config.reset')}
            </Button>
            <Button variant="solid" loading={save.isPending} disabled={changed === 0} onClick={() => save.mutate(patch)}>
              {changed > 0 ? `${t('common.save')} (${t('config.changed', { count: changed })})` : t('common.save')}
            </Button>
          </>
        }
      />
      <QueryState query={config} label={t('common.loading')}>
        {(data) => {
          const groups = new Map<string, ConfigKeyDescriptor[]>();
          for (const key of CONFIG_KEYS) {
            const name = key.path.split('.')[0] ?? key.path;
            const list = groups.get(name) ?? [];
            list.push(key);
            groups.set(name, list);
          }
          const none = `(${t('common.none')})`;
          // Bâti à chaque rendu, sans état : le rendu d'un enfant peut être rejoué.
          const tabs: TabItem[] = [...groups].map(([name, keys]) => ({
            id: name,
            label: name,
            content: (
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
                {keys.map((descriptor) => {
                  const inPatch = getPath(patch, descriptor.path) !== undefined;
                  const value = inPatch ? getPath(patch, descriptor.path) : getPath(data, descriptor.path);
                  return (
                    <Changed key={descriptor.path} changed={inPatch && !same(value, getPath(data, descriptor.path))}>
                      <Control
                        descriptor={descriptor}
                        value={value}
                        error={errors[descriptor.path]}
                        onChange={(next) => update(descriptor, next)}
                        options={optionsFor(descriptor, channels.data?.channels ?? [], roles.data?.roles ?? [], none)}
                      />
                    </Changed>
                  );
                })}
              </div>
            ),
          }));
          if (tabs.length === 0) return <Empty title={t('config.empty')} />;
          return (
            <Tabs
              tabs={tabs}
              value={tabs.some((tab) => tab.id === group) ? group : (tabs[0]?.id ?? '')}
              onChange={setGroup}
              label={t('config.title')}
            />
          );
        }}
      </QueryState>
    </Page>
  );
}
