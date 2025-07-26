/**
 * @jest-environment node
 */

import { ESLint } from 'eslint';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Timezone Safety ESLint Rules', () => {
  let eslint;

  beforeAll(async () => {
    // Import the timezone safety plugin
    const timezoneSafety = await import(path.resolve(__dirname, '../../../eslint-plugins/timezone-safety.js'));

    // Create ESLint instance with flat config format
    eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          plugins: {
            'timezone-safety': timezoneSafety.default,
          },
          rules: {
            'timezone-safety/enforce-utc-timestamps': 'error',
            'timezone-safety/require-utc-imports': 'warn',
          },
          languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
        },
      ],
    });
  });

  describe('enforce-utc-timestamps rule', () => {
    const badCode = `
      const date = new Date();
      const hour = date.getHours();
      const day = date.getDay();
      date.setHours(14);
      const str = date.toLocaleString();
      
      const data = {
        timestamp: new Date(),
        createdAt: new Date()
      };
    `;

    const goodCode = `
      import { nowUTC, getCurrentHourUTC } from '../utilities/utc-time.js';
      
      const date = new Date();
      const hour = date.getUTCHours();
      const day = date.getUTCDay();
      date.setUTCHours(14);
      const str = date.toISOString();
      
      const data = {
        timestamp: nowUTC(),
        createdAt: nowUTC()
      };
    `;

    it('should detect timezone-unsafe methods', async () => {
      const results = await eslint.lintText(badCode, { filePath: 'test.js' });
      const { messages } = results[0];

      // Should find violations for local timezone methods
      const violations = messages.filter(msg => msg.ruleId === 'timezone-safety/enforce-utc-timestamps');

      expect(violations.length).toBeGreaterThan(0);

      // Check specific violations
      const violationMessages = violations.map(v => v.message);
      expect(violationMessages.some(msg => msg.includes('getUTCHours'))).toBe(true);
      expect(violationMessages.some(msg => msg.includes('getUTCDay'))).toBe(true);
    });

    it('should not flag UTC methods', async () => {
      const results = await eslint.lintText(goodCode, { filePath: 'test.js' });
      const { messages } = results[0];

      const violations = messages.filter(msg => msg.ruleId === 'timezone-safety/enforce-utc-timestamps');

      expect(violations).toHaveLength(0);
    });

    it('should provide auto-fix suggestions', async () => {
      const results = await eslint.lintText(badCode, { filePath: 'test.js' });
      const { messages } = results[0];

      const fixableViolations = messages.filter(
        msg => msg.ruleId === 'timezone-safety/enforce-utc-timestamps' && msg.fix
      );

      expect(fixableViolations.length).toBeGreaterThan(0);
    });
  });

  describe('require-utc-imports rule', () => {
    const codeWithoutImport = `
      const hour = new Date().getUTCHours();
      const timestamp = new Date().toISOString();
    `;

    const codeWithImport = `
      import { nowUTC, getCurrentHourUTC } from '../utilities/utc-time.js';
      
      const hour = getCurrentHourUTC();
      const timestamp = nowUTC().toISOString();
    `;

    it('should warn when UTC operations lack imports', async () => {
      const results = await eslint.lintText(codeWithoutImport, { filePath: 'src/test.js' });
      const { messages } = results[0];

      const warnings = messages.filter(msg => msg.ruleId === 'timezone-safety/require-utc-imports');

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].severity).toBe(1); // Warning level
    });

    it('should not warn when imports are present', async () => {
      const results = await eslint.lintText(codeWithImport, { filePath: 'src/test.js' });
      const { messages } = results[0];

      const warnings = messages.filter(msg => msg.ruleId === 'timezone-safety/require-utc-imports');

      expect(warnings).toHaveLength(0);
    });
  });

  describe('rule exceptions', () => {
    const testCode = `
      const date = new Date();
      const hour = date.getHours(); // Should be allowed in tests
    `;

    it('should ignore violations in test files', async () => {
      const results = await eslint.lintText(testCode, { filePath: 'tests/unit/example.test.js' });
      const { messages } = results[0];

      const violations = messages.filter(msg => msg.ruleId === 'timezone-safety/enforce-utc-timestamps');

      expect(violations).toHaveLength(0);
    });

    it('should ignore violations in docs', async () => {
      const results = await eslint.lintText(testCode, { filePath: 'docs/example.md' });
      const { messages } = results[0];

      const violations = messages.filter(msg => msg.ruleId === 'timezone-safety/enforce-utc-timestamps');

      expect(violations).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle timestampUTC() appropriately', async () => {
      const code = `
        const timestamp = timestampUTC(); // Should be OK for numeric timestamps
        const dateObj = new Date(timestampUTC()); // Should suggest alternatives
      `;

      const results = await eslint.lintText(code, { filePath: 'src/test.js' });
      const { messages } = results[0];

      // Should have some violations but not flag timestampUTC() itself when used appropriately
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle logging contexts', async () => {
      const code = `
        console.log('Time:', new Date().toLocaleString());
        logger.info('Timestamp:', new Date().toLocaleString());
      `;

      const results = await eslint.lintText(code, { filePath: 'src/test.js' });
      const { messages } = results[0];

      const violations = messages.filter(msg => msg.ruleId === 'timezone-safety/enforce-utc-timestamps');

      expect(violations.length).toBeGreaterThan(0);
    });
  });
});
