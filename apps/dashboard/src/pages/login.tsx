import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '@/lib/auth';
import { Button } from '@/ds/button';
import { BrandMark } from '@/ds/brand';
import { Frame } from '@/ds/frame';
import { currentLocale, toggleLocale, type Locale } from '@/lib/i18n';

/*
 * CONNEXION. Une seule action : Discord. Le panneau n'a ni mot de passe ni
 * compte propre ; les jetons OAuth sont abandonnés dès la liaison (bot).
 * Une fois connecté, le visiteur revient à la page qu'il demandait, quand
 * elle est celle d'un serveur. La langue se change en bas de la carte.
 */

export function LoginPage() {
  const { t } = useTranslation();
  const { redirect: back } = useSearch({ from: '/login' });
  const other: Locale = currentLocale() === 'fr' ? 'en' : 'fr';
  const signIn = () => void authClient.signIn.social({ provider: 'discord', callbackURL: back ?? '/guilds' });
  return (
    <main className="grid flex-1 place-items-center p-6">
      <Frame tone="accent" className="flex w-[min(420px,100%)] flex-col items-center gap-6 p-8 anim-lift">
        <BrandMark size={64} />
        <div className="text-center">
          <h1 className="text-2xl">10CORDES</h1>
          <p className="text-desc mt-2">{t('login.subtitle')}</p>
        </div>
        <Button variant="solid" size="lg" className="w-full" onClick={signIn}>
          {t('login.button')}
        </Button>
        <p className="text-center text-xs leading-relaxed text-ink-faint">{t('login.note')}</p>
        <button
          type="button"
          onClick={toggleLocale}
          aria-label={`${t('nav.locale')} : ${other.toUpperCase()}`}
          className="text-label min-h-11 min-w-11 px-3 hover:text-ink enabled:active:translate-y-px"
        >
          {other.toUpperCase()}
        </button>
      </Frame>
    </main>
  );
}
