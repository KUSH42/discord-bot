export default {
  // Code style
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',

  // Line formatting
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,

  // Trailing elements
  trailingComma: 'es5', // More compatible than 'all'

  // Spacing
  bracketSpacing: true,
  bracketSameLine: false,

  // Arrow functions
  arrowParens: 'avoid', // Clean syntax for single params

  // Line endings
  endOfLine: 'lf', // Consistent across platforms

  // Embedded languages
  embeddedLanguageFormatting: 'auto',

  // HTML whitespace
  htmlWhitespaceSensitivity: 'css',

  // JSX
  jsxSingleQuote: true,

  // Prose
  proseWrap: 'preserve',

  // Override for specific file types
  overrides: [
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always',
      },
    },
    {
      files: '*.json',
      options: {
        printWidth: 80,
        tabWidth: 2,
      },
    },
    {
      files: '*.yml',
      options: {
        printWidth: 80,
        tabWidth: 2,
      },
    },
  ],
};
