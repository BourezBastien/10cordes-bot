import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useParams } from '@tanstack/react-router';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ModuleDescriptor {
  id: string;
  label: string;
  description: string;
  dependsOn?: string[];
  optionalDeps?: string[];
  recommends?: string[];
}

interface GuildModule extends ModuleDescriptor {
  globalEnabled: boolean;
  guildEnabled: boolean | null;
  constraints?: unknown;
}

interface ToggleResult {
  applied?: boolean;
  enabled?: string[];
  cascade?: { toDisable: string[]; kept: string[] };
}

export function ModulesPage() {
  const { t } = useTranslation();
  const { guildId } = useParams({ from: '/g/$guildId' });
  const queryClient = useQueryClient();
  // Désactivation : le premier clic reçoit la cascade et demande confirmation,
  // le deuxième clic (sur le même module) envoie confirm=true.
  const [confirmPending, setConfirmPending] = useState<Set<string>>(new Set());

  const stateQuery = useQuery({
    queryKey: ['guild', guildId, 'modules'],
    queryFn: () => api.get<{ modules: GuildModule[] }>(`/api/v1/guilds/${guildId}/modules`),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ moduleId, enabled, confirm }: { moduleId: string; enabled: boolean; confirm?: boolean }) =>
      api.patch<ToggleResult>(`/api/v1/guilds/${guildId}/modules/${moduleId}`, { enabled, confirm }),
    onSuccess: (data, variables) => {
      if (!variables.enabled && data.cascade && data.cascade.toDisable.length > 0) {
        setConfirmPending((prev) => new Set(prev).add(variables.moduleId));
        toast.warning(`${t('modules.cascade')} : ${data.cascade.toDisable.join(', ')}`);
        return;
      }
      setConfirmPending((prev) => {
        const next = new Set(prev);
        next.delete(variables.moduleId);
        return next;
      });
      toast.success(t('common.saved'));
      queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'modules'] });
    },
    onError: () => toast.error(t('common.error')),
  });

  const modules = stateQuery.data?.modules ?? [];

  const isEnabled = (module: GuildModule): boolean =>
    module.guildEnabled ?? module.globalEnabled ?? false;

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">{t('nav.modules')}</h1>
      <div className="flex flex-col gap-3">
        {modules.map((module) => {
          const enabled = isEnabled(module);
          const needsConfirm = confirmPending.has(module.id);
          return (
            <Card key={module.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{module.label}</CardTitle>
                  <CardDescription className="mt-1">{module.description}</CardDescription>
                  {module.dependsOn && module.dependsOn.length > 0 ? (
                    <CardDescription className="mt-1">
                      {t('modules.requires')} : {module.dependsOn.join(', ')}
                    </CardDescription>
                  ) : null}
                </div>
                <Button
                  variant={enabled ? (needsConfirm ? 'danger' : 'secondary') : 'default'}
                  size="sm"
                  disabled={toggleMutation.isPending}
                  onClick={() => {
                    if (enabled) {
                      toggleMutation.mutate({
                        moduleId: module.id,
                        enabled: false,
                        confirm: needsConfirm,
                      });
                    } else {
                      toggleMutation.mutate({ moduleId: module.id, enabled: true });
                    }
                  }}
                >
                  {enabled ? (needsConfirm ? t('modules.confirmDisable') : t('modules.disable')) : t('modules.enable')}
                </Button>
              </CardHeader>
              <CardContent className="text-xs text-ink-muted">
                {enabled ? t('modules.stateOn') : t('modules.stateOff')}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
