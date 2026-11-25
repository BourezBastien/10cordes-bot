import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/ds/badge';
import { Button } from '@/ds/button';
import { CardList } from '@/ds/card-list';
import { Empty, Notice } from '@/ds/kpi';
import { Frame } from '@/ds/frame';
import { Input } from '@/ds/field';
import { guildPath } from '@/shell/guild-list';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { fold } from '@/shell/search-palette';
import { api, errorMessage } from '@/lib/api';
import { useModules } from '@/lib/queries';
import { ModuleToggleResultSchema, type GuildModule } from '@/lib/schemas';

/*
 * MODULES. Ce que le bot fait sur ce serveur. Activer un module active ses
 * dépendances obligatoires ; le désactiver peut en emporter d'autres : le
 * premier clic les montre, le second confirme. Un module globalement
 * désactivé sur l'instance ne se règle pas ici.
 */

interface Toggle {
  id: string;
  enabled: boolean;
  confirm: boolean;
}

export function moduleActive(module: GuildModule): boolean {
  return module.guildEnabled ?? module.globalEnabled ?? false;
}

function Dependencies({ module }: { module: GuildModule }) {
  const { t } = useTranslation();
  const groups: Array<[label: string, ids: ReadonlyArray<string> | undefined, tone: 'accent' | 'info' | 'neutral']> = [
    [t('modules.requires'), module.dependsOn, 'accent'],
    [t('modules.recommends'), module.recommends, 'info'],
    [t('modules.optional'), module.optionalDeps, 'neutral'],
  ];
  const shown = groups.filter(([, ids]) => ids && ids.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map(([label, ids, tone]) => (
        <div key={label} className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-faint">{label} :</span>
          {ids?.map((id) => (
            <Badge key={id} tone={tone}>
              {id}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ModulesPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  // Modules dont la désactivation attend un second clic.
  const [confirming, setConfirming] = useState<ReadonlySet<string>>(() => new Set());
  const modules = useModules(guildId);

  const toggle = useMutation({
    mutationFn: (vars: Toggle) =>
      api.patch(
        guildPath(guildId, `/modules/${encodeURIComponent(vars.id)}`),
        { enabled: vars.enabled, confirm: vars.confirm },
        ModuleToggleResultSchema,
      ),
    onSuccess: (result, vars) => {
      const cascade = result.cascade?.toDisable ?? [];
      if (!vars.enabled && cascade.length > 0) {
        setConfirming((prev) => new Set(prev).add(vars.id));
        return;
      }
      setConfirming((prev) => {
        const next = new Set(prev);
        next.delete(vars.id);
        return next;
      });
      toast.success(vars.enabled ? t('modules.enabled') : t('modules.disabled'));
      void queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'modules'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const click = (module: GuildModule) => {
    if (moduleActive(module)) {
      toggle.mutate({ id: module.id, enabled: false, confirm: confirming.has(module.id) });
    } else {
      toggle.mutate({ id: module.id, enabled: true, confirm: false });
    }
  };

  return (
    <Page>
      <GuildHeader title={t('modules.title')} description={t('modules.description')} />
      <QueryState query={modules} label={t('common.loading')}>
        {(data) => {
          const needle = fold(filter);
          const list = data.modules.filter((module) => !needle || `${fold(module.id)} ${fold(module.label)} ${fold(module.description)}`.includes(needle));
          return (
            <>
              <Input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('modules.search')}
                aria-label={t('modules.search')}
                className="max-w-sm"
              />
              {data.modules.length === 0 ? (
                <Empty title={t('modules.empty')} />
              ) : (
                <CardList
                  items={list}
                  keyOf={(module) => module.id}
                  moreLabel={t('common.showMore')}
                  empty={<Empty title={t('common.empty')} />}
                  render={(module) => {
                    const active = moduleActive(module);
                    const waits = confirming.has(module.id);
                    const cascade = toggle.variables?.id === module.id ? toggle.data?.cascade : undefined;
                    return (
                      <Frame className="flex h-full flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-pixel text-sm text-ink">{module.label}</h3>
                            <p className="mt-1 text-sm text-ink-soft">{module.description}</p>
                          </div>
                          <Badge tone={active ? 'ok' : 'neutral'} solid={active}>
                            {active ? t('modules.stateOn') : t('modules.stateOff')}
                          </Badge>
                        </div>
                        <Dependencies module={module} />
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                          {waits ? (
                            <Notice tone="warn" title={t('modules.cascadeTitle')} className="min-w-0 flex-1">
                              <p>{t('modules.cascadeHint')}</p>
                              {cascade ? (
                                <p className="mt-1 text-xs text-ink-faint">
                                  {cascade.toDisable.length > 0 ? t('modules.cascadeAlso', { list: cascade.toDisable.join(', ') }) : null}
                                  {cascade.kept.length > 0 ? t('modules.cascadeKept', { list: cascade.kept.join(', ') }) : null}
                                </p>
                              ) : null}
                            </Notice>
                          ) : (
                            <span />
                          )}
                          <Button
                            variant={active ? (waits ? 'danger' : 'outline') : 'solid'}
                            size="sm"
                            loading={toggle.isPending && toggle.variables?.id === module.id}
                            onClick={() => click(module)}
                          >
                            {active ? (waits ? t('modules.confirmDisable') : t('modules.disable')) : t('modules.enable')}
                          </Button>
                        </div>
                      </Frame>
                    );
                  }}
                />
              )}
            </>
          );
        }}
      </QueryState>
    </Page>
  );
}
