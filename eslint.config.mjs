import { eslintConfig } from '@bluzzi/eslint-config';

export default [
  // Repos d'étude locaux : jamais lintés
  {
    ignores: ['references/**'],
  },
  ...eslintConfig({
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: true,
    },
  }),
];
