import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Notice } from '@/ds/kpi';
import { Button } from '@/ds/button';

/*
 * GARDE-FOU. Une erreur de rendu ne doit pas laisser un écran blanc : la
 * page affiche ce qui s'est passé et de quoi revenir au début.
 */

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Panne de rendu du panneau', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashScreen message={error.message} onReset={() => this.setState({ error: null })} />;
  }
}

function CrashScreen({ message, onReset }: { message: string; onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <Notice tone="danger" title={t('common.error')}>
        <p className="break-words">{message}</p>
      </Notice>
      <div>
        <Button size="sm" onClick={onReset}>
          {t('common.retry')}
        </Button>
      </div>
    </main>
  );
}
