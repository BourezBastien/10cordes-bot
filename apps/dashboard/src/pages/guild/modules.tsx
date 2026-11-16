import { useTranslation } from 'react-i18next';

export function ModulesPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t('nav.modules')}</h1>
      <p className="mt-2 text-ink-muted">Toggles modules avec cascade de dépendances (implémentation semaine 2).</p>
    </div>
  );
}
