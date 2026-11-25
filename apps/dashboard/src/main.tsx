import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource-variable/jetbrains-mono';
import './lib/i18n';
import { router } from './router';
import './styles/theme.css';

/*
 * ENTRÉE DU PANNEAU. Les deux polices sont auto-hébergées (aucune requête
 * vers un tiers : la politique de sécurité du contenu n'ouvre que soi-même).
 * La langue s'initialise avant le routeur : les écrans de garde l'utilisent.
 * Les avis (sonner) prennent le filet de 2 px du système, sans ombre.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const TOAST_STYLE: CSSProperties = {
  background: 'var(--color-panel)',
  color: 'var(--color-ink)',
  border: '2px solid var(--color-edge)',
  boxShadow: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: '14px',
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" toastOptions={{ style: TOAST_STYLE }} />
    </QueryClientProvider>
  </StrictMode>,
);
