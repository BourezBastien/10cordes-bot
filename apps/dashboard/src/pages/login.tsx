import { useSession } from '@/lib/auth';
import { Navigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';

export function LoginPage() {
  const { t } = useTranslation();
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <div className="grid h-full place-items-center text-ink-muted">{t('common.loading')}</div>;
  }
  if (session) {
    return <Navigate to="/guilds" />;
  }

  return (
    <div className="grid h-full place-items-center bg-canvas">
      <div className="flex w-80 flex-col items-center gap-6 rounded-lg border border-line bg-surface p-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-accent text-2xl font-bold text-canvas">
          10
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold">{t('login.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('login.subtitle')}</p>
        </div>
        <Button size="lg" className="w-full" onClick={() => authClient.signIn.social({ provider: 'discord', callbackURL: '/guilds' })}>
          {t('login.button')}
        </Button>
      </div>
    </div>
  );
}
