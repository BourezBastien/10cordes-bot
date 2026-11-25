import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { NATIVE_CAPABILITIES, type CapabilityRouteView, type ProviderView, type RouteTarget } from '@10cordes/shared';
import { Badge } from '@/ds/badge';
import { Button } from '@/ds/button';
import { Frame } from '@/ds/frame';
import { Select, type SelectOption } from '@/ds/select';
import { LoadError, Pending } from '@/shell/page';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useBindCapability, useCapabilities } from './api';
import { capabilityLabel, servingModels } from './labels';

/*
 * MATRICE DE ROUTAGE (zone C). Une ligne par capacité : son modèle
 * principal, et celui de repli en cas de 429 ou d'erreur 5xx. Chaque cible
 * se règle par deux listes (fournisseur, puis modèle). Choisir un
 * fournisseur lie aussitôt son premier modèle qui sert la capacité ; le bot
 * refuse, en nommant les modèles valides, un modèle qui ne la sert pas. Un
 * repli demande un modèle principal. Les routes de conversation qui
 * suivent encore chat.default le disent.
 */

const EMPTY = '__none__';
const CHAT_LINKED = ['chat.reasoning', 'chat.ingestion'];

/** Les capacités natives dans l'ordre du contrat, puis les capacités custom. */
export function orderCapabilities(routes: ReadonlyArray<CapabilityRouteView>): CapabilityRouteView[] {
  const rank = (capability: string): number => {
    const index = (NATIVE_CAPABILITIES as readonly string[]).indexOf(capability);
    return index < 0 ? NATIVE_CAPABILITIES.length : index;
  };
  return [...routes].sort((a, b) => rank(a.capability) - rank(b.capability) || a.capability.localeCompare(b.capability));
}

/** Le premier modèle du fournisseur qui sert la capacité ; à défaut, son premier modèle. */
export function firstServing(provider: ProviderView | undefined, capability: string): string | null {
  if (!provider) return null;
  return servingModels(provider.models, capability)[0]?.id ?? (provider.models[0]?.id ?? null);
}

interface TargetEditorProps {
  label: string;
  target: RouteTarget | null;
  providers: ReadonlyArray<ProviderView>;
  capability: string;
  disabled: boolean;
  busy: boolean;
  onProvider: (providerId: string) => void;
  onModel: (modelId: string) => void;
  onClear: () => void;
}

function TargetEditor({ label, target, providers, capability, disabled, busy, onProvider, onModel, onClear }: TargetEditorProps) {
  const { t } = useTranslation();
  const provider = target ? providers.find((item) => item.providerId === target.providerId) : undefined;
  const providerOptions: SelectOption<string>[] = [
    { value: EMPTY, label: t('providers.routesTable.chooseProvider') },
    ...providers.map((item) => ({ value: item.providerId, label: item.displayName })),
  ];
  const serving = provider ? servingModels(provider.models, capability) : [];
  const models = serving.length > 0 ? serving : (provider?.models ?? []);
  const modelOptions: SelectOption<string>[] = models.map((model) => ({ value: model.id, label: model.id }));
  return (
    <div className={cn('flex flex-col gap-1.5', disabled && 'opacity-50')}>
      <span className="text-label">{label}</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)_34px]">
        <Select
          size="sm"
          aria-label={`${label} : ${t('providers.routesTable.provider')}`}
          value={target?.providerId ?? EMPTY}
          options={providerOptions}
          disabled={disabled || busy}
          onChange={onProvider}
        />
        <Select
          size="sm"
          aria-label={`${label} : ${t('providers.routesTable.model')}`}
          value={target?.modelId ?? EMPTY}
          options={[{ value: EMPTY, label: t('providers.routesTable.chooseModel') }, ...modelOptions]}
          disabled={disabled || busy || !provider}
          onChange={onModel}
        />
        <Button
          size="sm"
          variant="ghost"
          className="px-0 sm:w-full"
          aria-label={t('providers.routesTable.unbind')}
          title={t('providers.routesTable.unbind')}
          disabled={disabled || busy || !target}
          onClick={onClear}
        >
          {/* Sur un petit écran la cible s'habille de son libellé ; sur une ligne de tableau elle tient en 34 px. */}
          <span className="px-3 sm:hidden">{t('providers.routesTable.unbind')}</span>
          <span aria-hidden className="hidden text-base leading-none sm:inline">
            ×
          </span>
        </Button>
      </div>
      {disabled ? <p className="text-xs text-ink-faint">{t('providers.routesTable.bindMainFirst')}</p> : null}
    </div>
  );
}

export function RouteMatrix({ guildId, providers }: { guildId: string; providers: ReadonlyArray<ProviderView> }) {
  const { t } = useTranslation();
  const capabilities = useCapabilities(guildId);
  const { bind, unbind } = useBindCapability(guildId);
  const byId = new Map(providers.map((provider) => [provider.providerId, provider]));
  const busy = bind.isPending || unbind.isPending;

  const done = (message: string) => ({
    onSuccess: () => toast.success(message),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });
  const bound = t('providers.routesTable.bound');
  const unbound = t('providers.routesTable.unboundMessage');
  const noModel = (capability: string) => toast.info(t('providers.routesTable.noModel', { capability: capabilityLabel(t, capability) }));
  const mainOf = (route: CapabilityRouteView) => (route.main ? { providerId: route.main.providerId, modelId: route.main.modelId } : null);

  const mainProvider = (route: CapabilityRouteView, providerId: string) => {
    if (providerId === EMPTY) {
      unbind.mutate(route.capability, done(unbound));
      return;
    }
    const modelId = firstServing(byId.get(providerId), route.capability);
    if (!modelId) return noModel(route.capability);
    bind.mutate({ capability: route.capability, body: { providerId, modelId } }, done(bound));
  };

  const mainModel = (route: CapabilityRouteView, modelId: string) => {
    if (route.main && modelId !== EMPTY) bind.mutate({ capability: route.capability, body: { providerId: route.main.providerId, modelId } }, done(bound));
  };

  const fallbackProvider = (route: CapabilityRouteView, providerId: string) => {
    const main = mainOf(route);
    if (!main) return;
    if (providerId === EMPTY) {
      bind.mutate({ capability: route.capability, body: { ...main, fallbackProviderId: null } }, done(bound));
      return;
    }
    const modelId = firstServing(byId.get(providerId), route.capability);
    if (!modelId) return noModel(route.capability);
    bind.mutate({ capability: route.capability, body: { ...main, fallbackProviderId: providerId, fallbackModelId: modelId } }, done(bound));
  };

  const fallbackModel = (route: CapabilityRouteView, modelId: string) => {
    const main = mainOf(route);
    if (main && route.fallback && modelId !== EMPTY) {
      bind.mutate(
        { capability: route.capability, body: { ...main, fallbackProviderId: route.fallback.providerId, fallbackModelId: modelId } },
        done(bound),
      );
    }
  };

  if (capabilities.isPending) return <Pending label={t('common.loading')} />;
  if (capabilities.isError) return <LoadError error={capabilities.error} onRetry={() => void capabilities.refetch()} />;

  return (
    <Frame className="flex flex-col">
      {orderCapabilities(capabilities.data.routes).map((route, index) => (
        <div
          key={route.capability}
          className={cn(
            'grid grid-cols-1 gap-4 px-5 py-4 lg:grid-cols-[minmax(0,10fr)_minmax(0,23fr)_minmax(0,23fr)] lg:items-center',
            index > 0 && 'border-t border-line',
          )}
        >
          <div className="min-w-0">
            <h3 className="font-pixel text-sm text-ink">{capabilityLabel(t, route.capability)}</h3>
            <p className="text-xs break-all text-ink-faint">{route.capability}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {route.main ? null : <Badge tone="warn">{t('providers.routesTable.unbound')}</Badge>}
              {route.followsDefault ? (
                <Badge tone="info">{t('providers.routesTable.followsDefault')}</Badge>
              ) : CHAT_LINKED.includes(route.capability) ? (
                <Badge>{t('providers.routesTable.independent')}</Badge>
              ) : null}
            </div>
          </div>
          <TargetEditor
            label={t('providers.routesTable.main')}
            target={route.main}
            providers={providers}
            capability={route.capability}
            disabled={false}
            busy={busy}
            onProvider={(providerId) => mainProvider(route, providerId)}
            onModel={(modelId) => mainModel(route, modelId)}
            onClear={() => unbind.mutate(route.capability, done(unbound))}
          />
          <TargetEditor
            label={t('providers.routesTable.fallback')}
            target={route.fallback}
            providers={providers}
            capability={route.capability}
            disabled={!route.main}
            busy={busy}
            onProvider={(providerId) => fallbackProvider(route, providerId)}
            onModel={(modelId) => fallbackModel(route, modelId)}
            onClear={() => fallbackProvider(route, EMPTY)}
          />
        </div>
      ))}
    </Frame>
  );
}
