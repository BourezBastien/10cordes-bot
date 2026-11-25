import { useTranslation } from 'react-i18next';
import type { ProviderTestResult, ProviderView } from '@10cordes/shared';
import { Badge, StatusDot } from '@/ds/badge';
import { Button } from '@/ds/button';
import { Frame } from '@/ds/frame';
import { Notice } from '@/ds/kpi';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { protocolLabel } from './labels';

/*
 * CARTE D'UN FOURNISSEUR. Pastille d'état (avec son compte à rebours de
 * refroidissement), badge de source (INSTANCE ou SERVEUR), nom, slug,
 * protocole, domaine, clé (jamais la valeur : ses quatre derniers
 * caractères au plus), état, dernier test, et quatre actions. La carte
 * retenue porte un cadre d'accent : le catalogue (zone B) montre ses modèles.
 */

export interface ProviderCardProps {
  provider: ProviderView;
  selected: boolean;
  onSelect: () => void;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Résultat du dernier test lancé depuis cette carte. */
  result?: ProviderTestResult | null;
}

export function ProviderCard({ provider, selected, onSelect, testing, onTest, onEdit, onDelete, result }: ProviderCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const { status, key } = provider;
  // Date du dernier test, en relatif (« il y a 5 minutes ») ; le libellé vient de la ligne du tableau.
  const lastTest = status.lastCheckedAt ? format.ago(status.lastCheckedAt) : null;
  const keyText = key.hasApiKey ? `${t('providers.key.set')}${key.keyHint ? ` · ${key.keyHint}` : ''}` : t('providers.key.missing');

  return (
    <Frame tone={selected ? 'accent' : 'line'} className={cn('flex h-full flex-col gap-3 p-4', !provider.enabled && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <StatusDot
          state={status.state}
          cooldownUntil={status.cooldownUntil}
          title={status.lastError}
          labels={{
            active: t('providers.status.active'),
            cooldown: t('providers.status.cooldown'),
            error: t('providers.status.error'),
            unknown: t('providers.status.unknown'),
          }}
        />
        <Badge tone={provider.source === 'instance' ? 'accent' : 'neutral'} solid={provider.source === 'instance'} title={t(`providers.sourceHint.${provider.source}`)}>
          {t(`providers.source.${provider.source}`)}
        </Badge>
      </div>
      <div className="min-w-0">
        <h3 className="truncate font-pixel text-sm text-ink">{provider.displayName}</h3>
        <p className="truncate text-xs text-ink-faint">{provider.slug}</p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-faint">{t('providers.rows.protocol')}</dt>
        <dd className="truncate text-ink-soft">{protocolLabel(t, provider.protocol)}</dd>
        <dt className="text-ink-faint">{t('providers.rows.domain')}</dt>
        <dd className="truncate text-ink-soft">{provider.domain}</dd>
        <dt className="text-ink-faint">{t('providers.rows.key')}</dt>
        <dd className={cn('truncate', key.hasApiKey ? 'text-ink-soft' : 'text-warn')}>{keyText}</dd>
        <dt className="text-ink-faint">{t('providers.rows.state')}</dt>
        <dd className="text-ink-soft">
          {provider.enabled ? t('providers.state.enabled') : t('providers.state.disabled')} ·{' '}
          {t('providers.rows.models', { count: provider.models.length })}
        </dd>
        {lastTest ? (
          <>
            <dt className="text-ink-faint">{t('providers.rows.lastTest')}</dt>
            <dd className="text-ink-soft">
              {lastTest}
              {status.lastHttpStatus ? ` · ${t('providers.http', { status: status.lastHttpStatus })}` : ''}
            </dd>
          </>
        ) : null}
      </dl>
      {status.lastError ? <p className="text-xs break-words text-danger-soft">{status.lastError}</p> : null}
      {result ? (
        <Notice tone={result.ok ? 'ok' : 'danger'}>
          {result.ok ? t('providers.testResult.ok', { count: result.modelsFound }) : t('providers.testResult.failed', { message: result.summary })}
        </Notice>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-1">
        <Button size="chip" loading={testing} onClick={onTest}>
          {t('providers.test')}
        </Button>
        <Button size="chip" variant={selected ? 'solid' : 'outline'} aria-pressed={selected} onClick={onSelect}>
          {t('providers.models')}
        </Button>
        <Button size="chip" variant="ghost" onClick={onEdit}>
          {t('providers.edit')}
        </Button>
        <Button size="chip" variant="ghost" className="text-danger-soft" onClick={onDelete}>
          {t('providers.delete')}
        </Button>
      </div>
    </Frame>
  );
}
