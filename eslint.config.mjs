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
);
