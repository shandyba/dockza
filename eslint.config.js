const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'vitest.config.mts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['error'] }],
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Release tooling: plain Node ESM, run directly by npm scripts and CI, never bundled.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: {
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Tests get the same rules but with relaxed `any` (mocks need it freely).
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'eqeqeq': ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  prettier,
);
