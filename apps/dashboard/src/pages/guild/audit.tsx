import { useTranslation } from 'react-i18next';

export function AuditPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{t('nav.audit')}</h1>
      <p className="mt-2 text-ink-muted">Journal d'audit paginé (implémentation semaine 2).</p>
    </div>
  );
}
