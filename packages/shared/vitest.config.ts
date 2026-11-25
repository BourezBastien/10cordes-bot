import { defineConfig } from 'vitest/config';

/*
 * Tests du contrat partagé, avec leur couverture. Le seuil de 80 % (lignes,
 * fonctions, branches, instructions) est un plancher : `pnpm test` l'exige,
 * donc `pnpm verify` et la CI aussi. Hors décompte, parce qu'ils n'ont rien
 * à exécuter : les barils d'export et les fichiers de types purs, et le
 * registre des outils, produit par sync-tool-names.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Deux rapports seulement : le tableau dans le journal de la CI, et le
      // résumé JSON (les chiffres). Le rapport HTML apporte du JavaScript que
      // la première passe de lint relèverait.
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/tools/registry-names.ts',
        'src/schemas/dashboard.ts',
        'src/schemas/surface.ts',
        'src/skills/blueprint.ts',
        'src/types/module-descriptor.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
