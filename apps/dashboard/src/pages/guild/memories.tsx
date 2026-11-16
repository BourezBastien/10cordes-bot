import { useTranslation } from 'react-i18next';

export function MemoriesPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t('nav.memories')}</h1>
      <p className="mt-2 text-ink-muted">Mémoires serveur et membres (implémentation semaine 2).</p>
    </div>
  );
}
