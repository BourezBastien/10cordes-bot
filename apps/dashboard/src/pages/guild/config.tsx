import { useTranslation } from 'react-i18next';

export function ConfigPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t('nav.config')}</h1>
      <p className="mt-2 text-ink-muted">Éditeur générique piloté par CONFIG_KEYS (implémentation semaine 2).</p>
    </div>
  );
}
