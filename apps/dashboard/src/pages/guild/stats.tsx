import { useTranslation } from 'react-i18next';

export function StatsPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t('nav.stats')}</h1>
      <p className="mt-2 text-ink-muted">Courbes ApexCharts : messages, XP, modération (implémentation semaine 2).</p>
    </div>
  );
}
