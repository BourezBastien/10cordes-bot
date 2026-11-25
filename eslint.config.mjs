import { eslintConfig } from '@bluzzi/eslint-config';

export default await eslintConfig(
  {
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: true,
    },
  },
  // Repos d'étude locaux : jamais lintés
  { ignores: ['references/**'] },
  // Scripts d'exploitation E2E (rigs manuels lancés à la main avec node,
  // jamais bundlés ni importés par le produit) : hors périmètre de lint.
  { ignores: ['apps/bot/scripts/**/*.mjs'] },
  // Rapports de couverture générés par vitest (gitignorés, jamais sources).
  { ignores: ['**/coverage/**'] },
);
