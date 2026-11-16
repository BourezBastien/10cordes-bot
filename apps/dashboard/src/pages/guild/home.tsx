import { useTranslation } from 'react-i18next';

export function GuildHomePage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t('nav.home')}</h1>
      <p className="mt-2 text-ink-muted">Aperçu du serveur : configuration, santé, activité (implémentation semaine 2).</p>
    </div>
  );
}
