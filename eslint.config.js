import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/.svelte-kit/**',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused vars fail the build (repo is currently at zero warnings, so this is a
      // safe gate that prevents dead-code accumulation even though CI runs plain `pnpm lint`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
