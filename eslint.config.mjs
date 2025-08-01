import globals from 'globals';
import pluginJs from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import jest from 'eslint-plugin-jest';
import timezoneSafety from './eslint-plugins/timezone-safety.js';

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'build/**',
      '.env*',
      '*.log',
      '.cache/**',
      '.nyc_output/**',
      'tests/fixtures/test-data.js', // Intentionally contains problematic code for testing
      'tests/security/input-validation.test.js', // Intentionally contains security test cases
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      prettier,
      jest,
      'timezone-safety': timezoneSafety,
    },
    rules: {
      ...pluginJs.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'warn',

      // Variable and function rules
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Console rules - allow in specific contexts
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error', 'info'],
        },
      ],

      // Code quality rules
      'no-useless-escape': 'error',
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // ES6+ rules
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'object-shorthand': 'warn',
      'prefer-destructuring': [
        'warn',
        {
          array: false,
          object: true,
        },
      ],

      // Performance rules
      'no-loop-func': 'error',
      'no-constant-condition': 'error',

      // Security rules
      'no-script-url': 'error',
      'no-octal-escape': 'error',

      // Timezone safety rules
      'timezone-safety/enforce-utc-timestamps': 'error',
      'timezone-safety/require-utc-imports': 'warn',
    },
  },

  // Test-specific configuration
  {
    files: ['**/*.test.js', '**/tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      jest,
    },
    rules: {
      ...jest.configs.recommended.rules,
      'no-console': 'off', // Allow console in tests
      'jest/expect-expect': 'warn',
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/prefer-to-have-length': 'warn',
      'jest/valid-expect': 'error',
    },
  },

  // Script-specific configuration
  {
    files: ['scripts/**/*.js', 'setup-*.js', '*.config.*'],
    rules: {
      'no-console': 'off', // Allow console in scripts
    },
  },

  // Main entry point configuration
  {
    files: ['index.js', 'src/x-scraper.js', 'src/youtube-monitor.js'],
    rules: {
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error', 'info', 'log'],
        },
      ], // More permissive for main files
    },
  },
];
