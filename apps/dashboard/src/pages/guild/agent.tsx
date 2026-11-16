import { useTranslation } from 'react-i18next';

export function AgentPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t('nav.agent')}</h1>
      <p className="mt-2 text-ink-muted">Chat avec l'agent (implémentation semaine 3).</p>
    </div>
  );
}
