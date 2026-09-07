/**
 * The frontend lint script had no configuration either, so it had never run.
 * Same principle as the backend: narrow enough that it passes today and
 * therefore stays switched on.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules', '*.cjs', 'public'],
  rules: {
    // The rule that catches real React bugs: stale closures and missing
    // dependencies.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    // Two deliberate @ts-ignore in legacy pages. The rule wants
    // @ts-expect-error, which is better style but would fail the build the day
    // the underlying error goes away.
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
  },
  overrides: [
    {
      files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test/**/*.ts'],
      env: { node: true },
      rules: { '@typescript-eslint/no-unused-vars': 'warn' },
    },
  ],
};
