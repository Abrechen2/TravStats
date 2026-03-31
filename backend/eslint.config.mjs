import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // TypeScript strict rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-unused-vars': 'off', // Use TS version instead

      // General quality rules
      'no-console': 'off', // Logger is preferred but console is used in bootstrap
      'no-undef': 'off', // TypeScript handles this
      'no-redeclare': 'off', // TypeScript handles this

      // ESLint 9 recommended rules disabled for pre-existing codebase
      'preserve-caught-error': 'off', // ~50 sites need cause chaining — defer to a dedicated cleanup pass
      'no-useless-assignment': 'off', // Several pre-existing cases — defer cleanup
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.test.ts', '**/*.d.ts', 'src/__mocks__/**'],
  },
];
