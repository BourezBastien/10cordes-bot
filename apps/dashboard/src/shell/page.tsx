import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Boot, Notice } from '@/ds';
import { Button } from '@/ds/button';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/*
 * PAGES ET ÉTATS. `Page` est le contenant d'une page : largeur utile de
 * 1280 px, marges de 40/32/64 px (20/16/112 sur mobile, pour laisser la
 * place à la barre basse). `Pending` est l'écran d'attente d'une lecture,
 * `LoadError` son écran d'échec, avec le message et de quoi réessayer.
 */

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn('mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 px-5 pt-5 pb-28 md:px-10 md:pt-8 md:pb-16', className)}>
      {children}
    </main>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Notice tone="danger" title={t('common.error')}>
      <p>{errorMessage(error)}</p>
      <div className="mt-3">
        <Button size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    </Notice>
  );
}

export function Pending({ label }: { label: string }) {
  return (
    <div className="grid flex-1 place-items-center" role="status" aria-label={label}>
      <Boot label={label} />
    </div>
  );
}

interface QueryLike {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** Rend le résultat d'une lecture quand elle est prête : attente, échec, ou le contenu. */
export function QueryState<TData>(props: {
  query: QueryLike & { data?: TData | undefined };
  label: string;
  children: (data: TData) => ReactNode;
}) {
  const { query, label, children } = props;
  if (query.isError) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <Pending label={label} />;
  return <>{children(query.data as TData)}</>;
}
