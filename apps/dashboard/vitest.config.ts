import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Même résolution de l'alias « @ » que vite.config.ts ; les styles ne sont pas
// traités ici (les composants ne dépendent pas de leur CSS pour être testés).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    restoreMocks: true,
    // Le rendu d'une page sous jsdom ralentit quand les tests du bot tournent
    // en même temps (les espaces de travail sont testés en parallèle) : une
    // page passée en une seconde seule en prend plus de cinq en concurrence.
    testTimeout: 30_000,
  },
});
