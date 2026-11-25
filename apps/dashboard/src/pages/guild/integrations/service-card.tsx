import { useTranslation } from 'react-i18next';
import type { IntegrationTestResult, IntegrationView } from '@10cordes/shared';
import { Badge } from '@/ds/badge';
import { Button } from '@/ds/button';
import { Frame } from '@/ds/frame';
import { Notice } from '@/ds/kpi';
import { Toggle } from '@/ds/field';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * CARTE D'UN SERVICE SPÉCIALISÉ (zone A). Nom, rôle (les outils qu'il
 * débloque), source de sa clé (base instance, clé serveur chiffrée, aucune),
 * activation sur ce serveur, et deux actions : configurer la clé, tester
 * l'accès. La clé ne s'affiche jamais : son statut seul.
 */

export interface ServiceCardProps {
  service: IntegrationView;
  testing: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onConfigure: () => void;
  onTest: () => void;
  result?: IntegrationTestResult | null;
}

const SOURCE_TONE = { instance: 'info', guild: 'accent', none: 'warn' } as const;

export function ServiceCard({ service, testing, busy, onToggle, onConfigure, onTest, result }: ServiceCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <Frame tone={service.enabled ? 'line' : 'edge'} className={cn('flex h-full flex-col gap-3 p-4', !service.enabled && 'opacity-75')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-pixel text-sm text-ink">{service.name}</h3>
          <p className="text-xs text-ink-faint">{service.slug}</p>
        </div>
        <Toggle checked={service.enabled} onCheckedChange={onToggle} disabled={busy} label={t('integrations.services.toggle', { name: service.name })} />
      </div>
      <p className="text-xs text-ink-soft">
        {service.tools.length === 0 ? t('integrations.services.noTools') : t('integrations.services.tools', { count: service.tools.length })}
      </p>
      <ul className="flex flex-wrap gap-1" aria-label={t('integrations.services.tools', { count: service.tools.length })}>
        {service.tools.map((tool) => (
          <li key={tool}>
            <Badge>{tool}</Badge>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-faint">{t('providers.rows.key')}</dt>
        <dd className="text-ink-soft">
          <Badge tone={SOURCE_TONE[service.source]}>{t(`integrations.services.source.${service.source}`)}</Badge>
          {service.key.hasApiKey && service.key.keyHint ? <span className="ml-2">{service.key.keyHint}</span> : null}
        </dd>
        <dt className="text-ink-faint">{t('providers.rows.state')}</dt>
        <dd className="text-ink-soft">{service.enabled ? t('integrations.services.enabled') : t('integrations.services.disabled')}</dd>
        {service.model ? (
          <>
            <dt className="text-ink-faint">{t('system.model')}</dt>
            <dd className="truncate text-ink-soft">{service.model}</dd>
          </>
        ) : null}
      </dl>
      {result ? (
        <Notice tone={result.ok ? 'ok' : 'danger'}>
          {result.ok ? t('integrations.testResult.ok', { ms: format.number(result.ms) }) : t('integrations.testResult.failed', { message: result.summary })}
        </Notice>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-1">
        <Button size="chip" variant="solid" onClick={onConfigure}>
          {t('integrations.services.configure')}
        </Button>
        <Button size="chip" loading={testing} onClick={onTest}>
          {t('integrations.services.test')}
        </Button>
      </div>
    </Frame>
  );
}
