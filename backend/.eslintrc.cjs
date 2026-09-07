/**
 * The lint script has existed since the repository was created and has never
 * run: there was no configuration file, so `npm run lint` failed with "ESLint
 * looked for configuration files ... If it found none".
 *
 * Deliberately narrow. The point is catching real mistakes in a 40,000-line
 * codebase that has never been linted, not reformatting all of it: a rule set
 * that produces thousands of findings gets switched off, which is how a project
 * ends up back here.
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'node_modules', '*.cjs'],
  rules: {
    // Real bugs.
    'no-console': 'off',                       // logs are how this service is observed
    'no-constant-condition': ['error', { checkLoops: false }],
    'require-atomic-updates': 'off',
    '@typescript-eslint/no-floating-promises': 'off',   // needs type info; too slow for CI here
    // Off, not warn. This rule is about style, not correctness, and there are
    // 59 pre-existing `any`s in legacy code. A rule that makes `npm run lint`
    // fail on day one is a rule that gets switched off — which is how this
    // repository ended up with a lint script that had never once run.
    '@typescript-eslint/no-explicit-any': 'off',
    // A warning by default: there are 39 unused references in legacy code that
    // predates this branch, and blocking on them would mean either editing code
    // this work is not meant to touch or turning the rule off. It is an error
    // in the new product (see the override below), so what we are building
    // stays clean while the debt stays visible.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    '@typescript-eslint/no-non-null-assertion': 'off',  // used deliberately after guards
    '@typescript-eslint/no-empty-function': 'off',
    // Express augments its own Request interface through a global namespace.
    '@typescript-eslint/no-namespace': 'off',
  },
  overrides: [
    {
      // The social-gallery product. Held to the stricter standard.
      files: [
        'src/app.ts',
        'src/config/**/*.ts',
        'src/lib/shopifyCatalog.ts',
        'src/middleware/productMode.ts',
        'src/services/billing/**/*.ts',
        'src/services/catalog/**/*.ts',
        'src/services/events/**/*.ts',
        'src/services/gallery/**/*.ts',
        'src/services/preview/**/*.ts',
        'src/routes/catalog.ts',
        'src/routes/gallery.ts',
        'src/routes/performance.ts',
        'src/routes/plans.ts',
        'src/routes/public.ts',
        'src/routes/publicGallery.ts',
        'src/routes/publicPreview.ts',
        'src/routes/subscription.ts',
      ],
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
        ],
      },
    },
    {
      files: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-unused-vars': 'warn',
      },
    },
  ],
};
