import tseslint from 'typescript-eslint';

/**
 * Passe TypeScript « bugs réels seulement » : quatre règles, toutes des
 * erreurs. La passe principale (eslint.config.mjs) reste consacrée aux
 * conventions, avec son bloc TypeScript désactivé : il porterait environ
 * 3 000 erreurs cosmétiques. Ici, rien d'autre n'est activé.
 *
 * Règle du projet : une violation se corrige, jamais ne se désactive.
 *
 * Le typage passe par les tsconfig : le paquet @10cordes/shared doit être
 * compilé (dist/) avant cette passe, sinon ses types sont inconnus et le
 * verdict change. Le script `lint` le compile d'abord.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.spraxium/**', '**/node_modules/**'] },
  {
    files: ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          // Fichiers TypeScript hors `include` de leur tsconfig : sans eux,
          // projectService refuse de les typer.
          allowDefaultProject: [
            'apps/bot/spraxium.config.ts',
            'apps/bot/config/components.config.ts',
            'apps/bot/config/development.config.ts',
            'apps/bot/config/http.config.ts',
            'packages/shared/tests/*.spec.ts',
          ],
        },
        // Monorepo pnpm : les tsconfig se résolvent depuis la racine du dépôt,
        // et non depuis le dossier d'où ESLint est lancé.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Une promesse non attendue cache un échec silencieux.
      '@typescript-eslint/no-floating-promises': 'error',
      // Await sur une valeur qui n'est pas une promesse.
      '@typescript-eslint/await-thenable': 'error',
      // Imports et variables mortes ; le préfixe `_` marque l'intention de ne pas utiliser.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
