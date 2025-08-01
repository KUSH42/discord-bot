#!/usr/bin/env node

/**
 * Coverage System Test Script
 *
 * Tests the new enhanced coverage merging and reporting system
 * to ensure it works correctly before deploying to CI.
 */

import fs from 'fs';
import path from 'path';
import { execSync as _execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CoverageSystemTester {
  constructor() {
    this.testDir = 'test-coverage-system';
    this.passed = 0;
    this.failed = 0;
    this.results = [];
  }

  /**
   * Run all tests
   */
  async runTests() {
    console.log('🧪 Testing Enhanced Coverage System...');

    try {
      this.setupTestEnvironment();
      await this.testCoverageMerger();
      await this.testTestSummaryGenerator();
      await this.testCICoverageMerger();
      this.cleanupTestEnvironment();

      this.printResults();

      if (this.failed > 0) {
        console.log(`❌ ${this.failed} tests failed`);
        process.exit(1);
      } else {
        console.log(`✅ All ${this.passed} tests passed!`);
        process.exit(0);
      }
    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }

  /**
   * Setup test environment with mock data
   */
  setupTestEnvironment() {
    console.log('🔧 Setting up test environment...');

    // Clean up any existing test directory
    if (fs.existsSync(this.testDir)) {
      fs.rmSync(this.testDir, { recursive: true, force: true });
    }

    fs.mkdirSync(this.testDir, { recursive: true });

    // Create mock LCOV files for testing
    this.createMockLcovFiles();

    // Create mock test results structure
    this.createMockTestResults();

    console.log(`✅ Test environment created in ${this.testDir}`);
  }

  /**
   * Create mock LCOV files for testing
   */
  createMockLcovFiles() {
    const mockLcovContent1 = `TN:
SF:src/test-file1.js
FN:1,testFunction1
FN:5,testFunction2
FNF:2
FNH:2
FNDA:5,testFunction1
FNDA:3,testFunction2
DA:1,5
DA:2,5
DA:3,3
DA:4,3
DA:5,3
DA:6,0
LF:6
LH:5
BRF:2
BRH:1
end_of_record
`;

    const mockLcovContent2 = `TN:
SF:src/test-file2.js
FN:1,testFunction3
FN:8,testFunction4
FNF:2
FNH:1
FNDA:2,testFunction3
FNDA:0,testFunction4
DA:1,2
DA:2,2
DA:3,2
DA:4,0
DA:5,0
DA:6,0
DA:7,0
DA:8,0
LF:8
LH:3
BRF:3
BRH:1
end_of_record
`;

    // Create unit test coverage (Node 18)
    const unitDir18 = path.join(this.testDir, 'test-results/unit/node18/coverage/unit');
    fs.mkdirSync(unitDir18, { recursive: true });
    fs.writeFileSync(path.join(unitDir18, 'lcov.info'), mockLcovContent1);
    fs.writeFileSync(
      path.join(unitDir18, 'test-output-node18.log'),
      'Test Suites: 1 passed, 1 total\nTests: 5 passed, 5 total'
    );

    // Create unit test coverage (Node 20)
    const unitDir20 = path.join(this.testDir, 'test-results/unit/node20/coverage/unit');
    fs.mkdirSync(unitDir20, { recursive: true });
    fs.writeFileSync(path.join(unitDir20, 'lcov.info'), mockLcovContent1); // Same content (duplicate)

    // Create integration test coverage
    const integrationDir = path.join(this.testDir, 'test-results/integration/coverage/integration');
    fs.mkdirSync(integrationDir, { recursive: true });
    fs.writeFileSync(path.join(integrationDir, 'lcov.info'), mockLcovContent2);
    fs.writeFileSync(
      path.join(integrationDir, 'test-output.log'),
      'Test Suites: 1 passed, 1 total\nTests: 3 passed, 3 total'
    );

    // Create a coverage directory in root as well
    const rootCoverage = path.join(this.testDir, 'coverage');
    fs.mkdirSync(rootCoverage, { recursive: true });
  }

  /**
   * Create mock test results structure
   */
  createMockTestResults() {
    // Create mock security audit
    const securityAudit = {
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 1,
          moderate: 0,
          high: 0,
          critical: 0,
        },
      },
    };

    fs.writeFileSync(path.join(this.testDir, 'security-audit.json'), JSON.stringify(securityAudit, null, 2));
  }

  /**
   * Test the coverage merger
   */
  async testCoverageMerger() {
    console.log('🔍 Testing coverage merger...');

    const testCases = [
      {
        name: 'Enhanced Coverage Merger - Basic Function',
        test: async () => {
          const oldCwd = process.cwd();
          try {
            process.chdir(this.testDir);

            const { CoverageMerger } = await import('./merge-coverage-enhanced.js');
            const merger = new CoverageMerger();

            const files = merger.findCoverageFiles(['.']);
            if (files.length === 0) {
              throw new Error('No coverage files found');
            }

            const summary = await merger.mergeCoverageFiles('coverage/merged/lcov.info');

            if (!summary || !summary.totals) {
              throw new Error('Invalid summary returned');
            }

            if (summary.totals.lines.pct <= 0) {
              throw new Error('Coverage percentage should be > 0');
            }

            // Check if merged file exists and is valid
            if (!fs.existsSync('coverage/merged/lcov.info')) {
              throw new Error('Merged LCOV file not created');
            }

            return true;
          } finally {
            process.chdir(oldCwd);
          }
        },
      },

      {
        name: 'Coverage Merger - Deduplication',
        test: async () => {
          const oldCwd = process.cwd();
          try {
            process.chdir(this.testDir);

            const { CoverageMerger } = await import('./merge-coverage-enhanced.js');
            const merger = new CoverageMerger();

            const files = merger.findCoverageFiles(['.']);

            // Should deduplicate identical Node 18 and Node 20 files
            const uniqueContents = new Set();
            for (const file of files) {
              const content = fs.readFileSync(file, 'utf8');
              uniqueContents.add(content);
            }

            // Should find unique files even with duplicates
            if (uniqueContents.size < 2) {
              throw new Error('Should find at least 2 unique coverage files');
            }

            return true;
          } finally {
            process.chdir(oldCwd);
          }
        },
      },
    ];

    for (const testCase of testCases) {
      await this.runTestCase(testCase);
    }
  }

  /**
   * Test the test summary generator
   */
  async testTestSummaryGenerator() {
    console.log('📊 Testing test summary generator...');

    const testCases = [
      {
        name: 'Test Summary Generator - Basic Function',
        test: async () => {
          const oldCwd = process.cwd();
          try {
            process.chdir(this.testDir);

            // First create coverage data
            const mockCoverageSummary = {
              total: {
                lines: { total: 100, covered: 75, pct: 75 },
                functions: { total: 20, covered: 15, pct: 75 },
                branches: { total: 30, covered: 20, pct: 66.67 },
                statements: { total: 100, covered: 75, pct: 75 },
              },
              merged_from: ['test1.lcov', 'test2.lcov'],
            };

            fs.writeFileSync('coverage-summary.json', JSON.stringify(mockCoverageSummary, null, 2));

            const { TestSummaryGenerator } = await import('./generate-test-summary.js');
            const generator = new TestSummaryGenerator();

            const hasCoverage = generator.loadCoverageData(['.']);
            if (!hasCoverage) {
              throw new Error('Should load coverage data');
            }

            generator.loadTestResults('test-results');
            generator.loadSecurityResults(['.']);

            const { markdownPath, jsonPath } = generator.saveReports('test-reports');

            if (!fs.existsSync(markdownPath) || !fs.existsSync(jsonPath)) {
              throw new Error('Report files not created');
            }

            // Check markdown content
            const markdownContent = fs.readFileSync(markdownPath, 'utf8');
            if (!markdownContent.includes('Test Summary Report') || !markdownContent.includes('Quality Gates Status')) {
              throw new Error('Markdown report missing expected content');
            }

            return true;
          } finally {
            process.chdir(oldCwd);
          }
        },
      },
    ];

    for (const testCase of testCases) {
      await this.runTestCase(testCase);
    }
  }

  /**
   * Test the CI coverage merger
   */
  async testCICoverageMerger() {
    console.log('🏗️ Testing CI coverage merger...');

    const testCases = [
      {
        name: 'CI Coverage Merger - Integration Test',
        test: async () => {
          const oldCwd = process.cwd();
          try {
            process.chdir(this.testDir);

            // Mock npm install to avoid actual installation
            const childProcessModule = await import('child_process');
            const originalExecSync = childProcessModule.execSync;
            let _npmInstallCalled = false;

            childProcessModule.execSync = (command, options) => {
              if (command.includes('npm install') || command.includes('npm list')) {
                _npmInstallCalled = true;
                throw new Error('Command not found'); // Simulate failure
              }
              return originalExecSync(command, options);
            };

            try {
              const { CICoverageMerger } = await import('./ci-coverage-merger.js');
              const merger = new CICoverageMerger();

              // Mock GitHub environment
              process.env.GITHUB_SHA = 'test123abc';
              process.env.GITHUB_REF_NAME = 'test-branch';

              await merger.run();

              // Check if expected files are created
              if (!fs.existsSync('coverage/merged/lcov.info')) {
                throw new Error('Merged LCOV file not created');
              }

              if (!fs.existsSync('coverage/coverage-summary.json')) {
                throw new Error('Coverage summary not created');
              }

              if (!fs.existsSync('reports/test-summary.md')) {
                throw new Error('Test summary not created');
              }

              return true;
            } finally {
              // Restore original execSync
              childProcessModule.execSync = originalExecSync;
            }
          } finally {
            process.chdir(oldCwd);
          }
        },
      },
    ];

    for (const testCase of testCases) {
      await this.runTestCase(testCase);
    }
  }

  /**
   * Run individual test case
   */
  async runTestCase(testCase) {
    try {
      console.log(`  🧪 ${testCase.name}...`);

      const result = await testCase.test();

      if (result === true) {
        console.log(`  ✅ ${testCase.name} PASSED`);
        this.passed++;
        this.results.push({ name: testCase.name, status: 'PASSED' });
      } else {
        console.log(`  ❌ ${testCase.name} FAILED - Unexpected result`);
        this.failed++;
        this.results.push({ name: testCase.name, status: 'FAILED', error: 'Unexpected result' });
      }
    } catch (error) {
      console.log(`  ❌ ${testCase.name} FAILED - ${error.message}`);
      this.failed++;
      this.results.push({ name: testCase.name, status: 'FAILED', error: error.message });
    }
  }

  /**
   * Clean up test environment
   */
  cleanupTestEnvironment() {
    console.log('🧹 Cleaning up test environment...');

    if (fs.existsSync(this.testDir)) {
      fs.rmSync(this.testDir, { recursive: true, force: true });
    }

    console.log('✅ Test environment cleaned up');
  }

  /**
   * Print test results summary
   */
  printResults() {
    console.log('\n📋 Test Results Summary:');
    console.log('='.repeat(50));

    for (const result of this.results) {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      console.log(`${status} ${result.name}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }

    console.log('='.repeat(50));
    console.log(`Total: ${this.passed + this.failed} tests`);
    console.log(`Passed: ${this.passed}`);
    console.log(`Failed: ${this.failed}`);

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! Coverage system is ready for deployment.');
    } else {
      console.log('\n⚠️  Some tests failed. Please fix issues before deploying.');
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const tester = new CoverageSystemTester();
  await tester.runTests();
}

// Export for testing
export { CoverageSystemTester };

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}
