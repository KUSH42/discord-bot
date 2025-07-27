/**
 * ESLint plugin for enforcing UTC timezone safety
 * Prevents timezone-related bugs by enforcing UTC timestamp usage
 */

const enforceUtcTimestamps = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce UTC timestamp usage for consistency across timezones',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noLocalDateMethods: 'Use UTC methods instead of local timezone methods. Use {{suggestion}} instead.',
      noDirectDateStorage: 'Store timestamps in UTC format. Use .toISOString() or UTC utility functions.',
      preferUtcUtilities: 'Use UTC utility functions from utilities/utc-time.js instead of {{method}}.',
      noTimezoneDependent: 'Avoid timezone-dependent operations. Use UTC-based alternatives.',
    },
  },
  create(context) {
    // Method mappings from problematic to UTC equivalents
    const problematicMethods = {
      getHours: 'getUTCHours',
      getMinutes: 'getUTCMinutes',
      getSeconds: 'getUTCSeconds',
      getDay: 'getUTCDay',
      getDate: 'getUTCDate',
      getMonth: 'getUTCMonth',
      getFullYear: 'getUTCFullYear',
      setHours: 'setUTCHours',
      setMinutes: 'setUTCMinutes',
      setSeconds: 'setUTCSeconds',
      setDate: 'setUTCDate',
      setMonth: 'setUTCMonth',
      setFullYear: 'setUTCFullYear',
      toLocaleString: 'toISOString',
      toLocaleDateString: 'toISOString',
      toLocaleTimeString: 'toISOString',
    };

    function isTestFile(filename) {
      return (
        filename.includes('.test.js') ||
        filename.includes('/tests/') ||
        filename.includes('.md') ||
        filename.includes('/docs/')
      );
    }

    function isTimestampProperty(propertyName) {
      const timestampProperties = ['timestamp', 'time', 'createdAt', 'updatedAt', 'startTime', 'stopTime'];
      return timestampProperties.includes(propertyName);
    }

    return {
      MemberExpression(node) {
        // Skip if not a simple object.property pattern
        if (
          !node.object ||
          node.object.type !== 'Identifier' ||
          !node.property ||
          node.property.type !== 'Identifier'
        ) {
          return;
        }

        const objectName = node.object.name;
        const propertyName = node.property.name;

        // Check for problematic Date methods (only on Date objects or date-like variables)
        if (Object.prototype.hasOwnProperty.call(problematicMethods, propertyName)) {
          const filename = context.getFilename();
          if (isTestFile(filename)) {
            return;
          }

          // Only flag if this appears to be a Date object method call
          const isLikelyDateObject =
            objectName === 'date' ||
            objectName === 'Date' ||
            objectName.toLowerCase().includes('date') ||
            objectName.toLowerCase().includes('time') ||
            objectName === 'now' ||
            objectName === 'timestamp';

          if (isLikelyDateObject) {
            context.report({
              node,
              messageId: 'noLocalDateMethods',
              data: {
                suggestion: problematicMethods[propertyName],
              },
              fix(fixer) {
                return fixer.replaceText(node.property, problematicMethods[propertyName]);
              },
            });
          }
        }

        // Check for Date.parse() usage (Date.now() is timezone-safe)
        if (objectName === 'Date' && propertyName === 'parse') {
          const { parent } = node;
          if (parent && parent.type === 'CallExpression') {
            context.report({
              node,
              messageId: 'preferUtcUtilities',
              data: {
                method: `Date.${propertyName}()`,
              },
            });
          }
        }
      },

      NewExpression(node) {
        if (!node.callee || node.callee.name !== 'Date') {
          return;
        }

        const filename = context.getFilename();
        if (isTestFile(filename)) {
          return;
        }

        const { parent } = node;
        if (!parent) {
          return;
        }

        // Check if this Date object is being used for timestamp storage
        let isTimestampUsage = false;

        if (parent.type === 'AssignmentExpression' && parent.left && parent.left.property) {
          isTimestampUsage = isTimestampProperty(parent.left.property.name);
        } else if (parent.type === 'Property' && parent.key) {
          isTimestampUsage = isTimestampProperty(parent.key.name);
        }

        if (isTimestampUsage) {
          context.report({
            node,
            messageId: 'preferUtcUtilities',
            data: {
              method: 'new Date()',
            },
            fix(fixer) {
              return fixer.replaceText(node, 'nowUTC()');
            },
          });
        }
      },

      CallExpression(node) {
        if (!node.callee || node.callee.type !== 'MemberExpression') {
          return;
        }

        const objectName = node.callee.object && node.callee.object.name;
        const methodName = node.callee.property && node.callee.property.name;

        // Check logging calls for timezone issues
        if (
          (objectName === 'logger' || objectName === 'console') &&
          (methodName === 'info' || methodName === 'log' || methodName === 'warn' || methodName === 'error')
        ) {
          const filename = context.getFilename();
          if (isTestFile(filename)) {
            return;
          }

          // Check if arguments contain non-UTC date operations
          node.arguments.forEach(arg => {
            if (
              arg.type === 'CallExpression' &&
              arg.callee &&
              arg.callee.type === 'MemberExpression' &&
              arg.callee.property &&
              arg.callee.property.name === 'toLocaleString'
            ) {
              context.report({
                node: arg,
                messageId: 'noDirectDateStorage',
              });
            }
          });
        }
      },
    };
  },
};

const requireUtcImports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require importing UTC utilities when using date operations',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      missingUtcImport:
        'Import UTC utility functions when performing date operations. Add: import { {{functions}} } from "../utilities/utc-time.js"',
    },
  },
  create(context) {
    let hasUtcImport = false;
    let hasDateOperations = false;
    const dateOperations = new Set();

    function isTestFile(filename) {
      return (
        filename.includes('.test.js') ||
        filename.includes('/tests/') ||
        filename.includes('/docs/') ||
        filename.includes('.md')
      );
    }

    return {
      ImportDeclaration(node) {
        if (node.source && node.source.value && node.source.value.includes('utilities/utc-time.js')) {
          hasUtcImport = true;
        }
      },

      MemberExpression(node) {
        if (!node.property || node.property.type !== 'Identifier') {
          return;
        }

        const propertyName = node.property.name;
        const utcMethods = [
          'getUTCHours',
          'getUTCMinutes',
          'getUTCSeconds',
          'getUTCDay',
          'getUTCDate',
          'getUTCMonth',
          'getUTCFullYear',
          'setUTCHours',
          'setUTCMinutes',
          'setUTCSeconds',
          'setUTCDate',
          'setUTCMonth',
          'setUTCFullYear',
          'toISOString',
        ];

        if (utcMethods.includes(propertyName)) {
          hasDateOperations = true;
          dateOperations.add('nowUTC, toISOStringUTC');
        }
      },

      NewExpression(node) {
        if (node.callee && node.callee.name === 'Date') {
          hasDateOperations = true;
          dateOperations.add('nowUTC');
        }
      },

      'Program:exit'() {
        const filename = context.getFilename();
        if (isTestFile(filename)) {
          return;
        }

        if (hasDateOperations && !hasUtcImport && dateOperations.size > 0) {
          context.report({
            node: context.getSourceCode().ast,
            messageId: 'missingUtcImport',
            data: {
              functions: Array.from(dateOperations).join(', '),
            },
          });
        }
      },
    };
  },
};

export default {
  meta: {
    name: 'timezone-safety',
    version: '1.0.0',
  },
  rules: {
    'enforce-utc-timestamps': enforceUtcTimestamps,
    'require-utc-imports': requireUtcImports,
  },
};
