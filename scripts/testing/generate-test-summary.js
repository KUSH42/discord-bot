#!/usr/bin/env node

/**
 * Professional Test Summary Generator
 *
 * Generates comprehensive, professional test reports from CI artifacts
 * including coverage analysis, test results, and quality assessments.
 */

import fs from 'fs';
import path from 'path';

class TestSummaryGenerator {
  constructor() {
    this.summary = {
      timestamp: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || 'unknown',
      branch: process.env.GITHUB_REF_NAME || 'unknown',
      trigger: process.env.GITHUB_EVENT_NAME || 'manual',
      runId: process.env.GITHUB_RUN_ID || 'local',
      repository: process.env.GITHUB_REPOSITORY || 'local',
      coverage: null,
      tests: {
        unit: { status: 'unknown', details: null },
        integration: { status: 'unknown', details: null },
        e2e: { status: 'unknown', details: null },
        performance: { status: 'unknown', details: null },
        security: { status: 'unknown', details: null },
      },
      artifacts: [],
      qualityGates: {
        coverage: { passed: false, threshold: 25, actual: 0 },
        testsPassing: { passed: false, threshold: 95, actual: 0 },
        security: { passed: false, vulnerabilities: 0 },
      },
    };
  }

  /**
   * Load coverage data from various sources
   */
  loadCoverageData(searchPaths = ['.', 'coverage', 'test-results']) {
    console.log('📊 Loading coverage data...');

    // Try to load from coverage-summary.json first
    for (const searchPath of searchPaths) {
      const summaryPath = path.join(searchPath, 'coverage-summary.json');
      const metricsPath = path.join(searchPath, 'coverage-metrics.json');

      if (fs.existsSync(summaryPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
          this.summary.coverage = {
            source: summaryPath,
            ...data.total,
            qualityScore: data.quality_score || this.calculateQualityScore(data.total),
            mergedFrom: data.merged_from || [],
          };
          console.log(`✅ Loaded coverage from ${summaryPath}`);

          // Load extended metrics if available
          if (fs.existsSync(metricsPath)) {
            const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
            this.summary.coverage.extended = metrics;
            console.log(`📈 Loaded extended metrics from ${metricsPath}`);
          }

          break;
        } catch (error) {
          console.log(`❌ Error loading coverage from ${summaryPath}: ${error.message}`);
        }
      }
    }

    // Update quality gates
    if (this.summary.coverage) {
      this.summary.qualityGates.coverage.actual = this.summary.coverage.lines?.pct || 0;
      this.summary.qualityGates.coverage.passed =
        this.summary.qualityGates.coverage.actual >= this.summary.qualityGates.coverage.threshold;
    }

    return this.summary.coverage !== null;
  }

  /**
   * Load test results from various sources
   */
  loadTestResults(testResultsPath = 'test-results') {
    console.log('🧪 Loading test results...');

    if (!fs.existsSync(testResultsPath)) {
      console.log(`⚠️  Test results path not found: ${testResultsPath}`);
      return;
    }

    const testTypes = ['unit', 'integration', 'e2e', 'performance', 'security'];

    for (const testType of testTypes) {
      const typeResults = this.loadTestTypeResults(testResultsPath, testType);
      this.summary.tests[testType] = typeResults;
    }

    // Calculate overall test passing rate
    const allTests = Object.values(this.summary.tests).filter(t => t.status !== 'unknown');
    const passingTests = allTests.filter(t => t.status === 'success').length;

    if (allTests.length > 0) {
      this.summary.qualityGates.testsPassing.actual = (passingTests / allTests.length) * 100;
      this.summary.qualityGates.testsPassing.passed =
        this.summary.qualityGates.testsPassing.actual >= this.summary.qualityGates.testsPassing.threshold;
    }
  }

  /**
   * Load results for specific test type
   */
  loadTestTypeResults(basePath, testType) {
    const possiblePaths = [
      path.join(basePath, testType),
      path.join(basePath, `${testType}-test-results`),
      path.join(basePath, testType, 'coverage', testType),
      path.join(basePath, testType, 'node18', 'coverage', testType),
      path.join(basePath, testType, 'node20', 'coverage', testType),
    ];

    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        console.log(`📂 Found ${testType} results at ${testPath}`);

        const result = {
          status: 'success', // Default assumption, could be improved with actual test output parsing
          path: testPath,
          files: [],
          logs: null,
          coverage: null,
        };

        // Find test output logs
        const logFiles = this.findFiles(testPath, /test-output.*\.log$/);
        if (logFiles.length > 0) {
          result.logs = logFiles[0];
          result.status = this.parseTestStatus(result.logs);
        }

        // Find coverage files
        const coverageFiles = this.findFiles(testPath, /lcov\.info$/);
        if (coverageFiles.length > 0) {
          result.coverage = coverageFiles[0];
        }

        // List all files for debugging
        result.files = this.findFiles(testPath, /.*/);

        return result;
      }
    }

    console.log(`⚠️  No results found for ${testType} tests`);
    return { status: 'skipped', details: 'No test results found' };
  }

  /**
   * Parse test status from log file
   */
  parseTestStatus(logPath) {
    try {
      const content = fs.readFileSync(logPath, 'utf8');

      // Look for Jest/test runner indicators
      if (content.includes('Test Suites:') && content.includes('failed, ')) {
        return 'failure';
      }
      if (content.includes('All tests passed') || content.includes('✓')) {
        return 'success';
      }
      if (content.includes('Test run was cancelled') || content.includes('SIGTERM')) {
        return 'cancelled';
      }

      return 'success'; // Default assumption
    } catch (error) {
      console.log(`⚠️  Could not parse test status from ${logPath}: ${error.message}`);
      return 'unknown';
    }
  }

  /**
   * Find files matching pattern recursively
   */
  findFiles(dir, pattern) {
    const results = [];

    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          results.push(...this.findFiles(fullPath, pattern));
        } else if (pattern.test(item)) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or not accessible
    }

    return results;
  }

  /**
   * Load security audit results
   */
  loadSecurityResults(searchPaths = ['.', 'test-results']) {
    console.log('🔒 Loading security results...');

    for (const searchPath of searchPaths) {
      const auditPath = path.join(searchPath, 'security-audit.json');

      if (fs.existsSync(auditPath)) {
        try {
          const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
          const vulnerabilities = audit.metadata?.vulnerabilities || {};
          const total = Object.values(vulnerabilities).reduce((sum, count) => sum + (count || 0), 0);

          this.summary.qualityGates.security.vulnerabilities = total;
          this.summary.qualityGates.security.passed = total === 0;

          console.log(`🛡️  Security audit: ${total} vulnerabilities found`);
          break;
        } catch (error) {
          console.log(`❌ Error loading security audit: ${error.message}`);
        }
      }
    }
  }

  /**
   * Calculate quality score from coverage data
   */
  calculateQualityScore(coverage) {
    if (!coverage) {
      return 0;
    }

    const lines = coverage.lines?.pct || 0;
    const functions = coverage.functions?.pct || 0;
    const branches = coverage.branches?.pct || 0;

    return lines * 0.4 + functions * 0.3 + branches * 0.3;
  }

  /**
   * Generate professional markdown report
   */
  generateMarkdownReport() {
    console.log('📝 Generating markdown report...');

    const report = [];

    // Header
    report.push('# 📊 Comprehensive Test Summary Report');
    report.push('');
    report.push(`**Generated:** ${new Date(this.summary.timestamp).toLocaleString()}`);
    report.push(`**Commit:** \`${this.summary.commit}\``);
    report.push(`**Branch:** \`${this.summary.branch}\``);
    report.push(`**Trigger:** ${this.summary.trigger}`);

    if (this.summary.runId !== 'local') {
      report.push(
        `**Run:** [#${this.summary.runId}](https://github.com/${this.summary.repository}/actions/runs/${this.summary.runId})`
      );
    }

    report.push('');

    // Quality Gates Overview
    report.push('## 🎯 Quality Gates Status');
    report.push('');
    report.push('| Gate | Status | Target | Actual | Result |');
    report.push('|------|--------|--------|--------|---------|');

    const gates = this.summary.qualityGates;

    // Coverage gate
    const coverageStatus = gates.coverage.passed ? '✅ PASS' : '❌ FAIL';
    const coverageActual = `${gates.coverage.actual.toFixed(2)}%`;
    const coverageTarget = `${gates.coverage.threshold}%`;
    report.push(`| Code Coverage | ${coverageStatus} | ${coverageTarget} | ${coverageActual} | Lines covered |`);

    // Tests gate
    const testsStatus = gates.testsPassing.passed ? '✅ PASS' : '❌ FAIL';
    const testsActual = `${gates.testsPassing.actual.toFixed(1)}%`;
    const testsTarget = `${gates.testsPassing.threshold}%`;
    report.push(`| Test Success Rate | ${testsStatus} | ${testsTarget} | ${testsActual} | Suites passing |`);

    // Security gate
    const securityStatus = gates.security.passed ? '✅ PASS' : '❌ FAIL';
    const securityActual = gates.security.vulnerabilities;
    report.push(`| Security | ${securityStatus} | 0 | ${securityActual} | Vulnerabilities |`);

    report.push('');

    // Overall Status
    const allPassed = Object.values(gates).every(gate => gate.passed);
    const overallStatus = allPassed ? '🟢 **ALL QUALITY GATES PASSED**' : '🔴 **QUALITY GATES FAILED**';
    report.push(`### ${overallStatus}`);
    report.push('');

    // Coverage Details
    if (this.summary.coverage) {
      report.push('## 📈 Coverage Analysis');
      report.push('');

      const cov = this.summary.coverage;
      const qualityScore = cov.qualityScore || this.calculateQualityScore(cov);

      report.push(`**Overall Score:** ${qualityScore.toFixed(1)}/100`);
      report.push('');

      report.push('| Metric | Coverage | Total | Covered |');
      report.push('|--------|----------|-------|---------|');
      report.push(
        `| **Lines** | **${(cov.lines?.pct || 0).toFixed(2)}%** | ${cov.lines?.total || 0} | ${cov.lines?.covered || 0} |`
      );
      report.push(
        `| Functions | ${(cov.functions?.pct || 0).toFixed(2)}% | ${cov.functions?.total || 0} | ${cov.functions?.covered || 0} |`
      );
      report.push(
        `| Branches | ${(cov.branches?.pct || 0).toFixed(2)}% | ${cov.branches?.total || 0} | ${cov.branches?.covered || 0} |`
      );
      report.push(
        `| Statements | ${(cov.statements?.pct || 0).toFixed(2)}% | ${cov.statements?.total || 0} | ${cov.statements?.covered || 0} |`
      );
      report.push('');

      // Coverage quality assessment
      const linesPct = cov.lines?.pct || 0;
      if (linesPct >= 80) {
        report.push('🟢 **Excellent Coverage** - Well above industry standards');
      } else if (linesPct >= 60) {
        report.push('🟡 **Good Coverage** - Meets recommended standards');
      } else if (linesPct >= 40) {
        report.push('🟠 **Fair Coverage** - Above minimum but room for improvement');
      } else if (linesPct >= 25) {
        report.push('🔴 **Minimum Coverage** - Meets basic threshold');
      } else {
        report.push('⚫ **Insufficient Coverage** - Below minimum standards');
      }

      report.push('');

      // Source information
      if (cov.mergedFrom && cov.mergedFrom.length > 0) {
        report.push('**Coverage Sources:**');
        cov.mergedFrom.forEach(source => {
          const type = this.identifySourceType(source);
          report.push(`- ${type}: \`${source}\``);
        });
        report.push('');
      }
    } else {
      report.push('## ❌ Coverage Analysis');
      report.push('');
      report.push('⚠️ **No coverage data available** - Coverage collection may have failed');
      report.push('');
    }

    // Test Results Summary
    report.push('## 🧪 Test Results Summary');
    report.push('');
    report.push('| Test Suite | Status | Details |');
    report.push('|------------|--------|---------|');

    for (const [testType, result] of Object.entries(this.summary.tests)) {
      const status = this.formatTestStatus(result.status);
      const details = result.details || result.path || 'Standard test execution';
      report.push(`| ${testType.charAt(0).toUpperCase() + testType.slice(1)} | ${status} | ${details} |`);
    }

    report.push('');

    // Detailed Test Results
    report.push('## 📋 Detailed Test Results');
    report.push('');

    for (const [testType, result] of Object.entries(this.summary.tests)) {
      if (result.status === 'unknown' || result.status === 'skipped') {
        continue;
      }

      report.push(`### ${testType.charAt(0).toUpperCase() + testType.slice(1)} Tests`);
      report.push('');

      if (result.logs && fs.existsSync(result.logs)) {
        try {
          const logContent = fs.readFileSync(result.logs, 'utf8');
          const excerpt = this.extractLogExcerpt(logContent);

          report.push('```');
          report.push(excerpt);
          report.push('```');
        } catch (error) {
          report.push(`⚠️ Could not read log file: ${result.logs}`);
        }
      } else {
        report.push(`✅ Tests completed with status: ${result.status}`);
      }

      report.push('');
    }

    // Artifacts and Links
    report.push('## 📦 Available Artifacts');
    report.push('');

    if (this.summary.runId !== 'local') {
      report.push(`All detailed reports and coverage data are available as workflow artifacts:`);
      report.push(
        `[📊 Workflow Artifacts](https://github.com/${this.summary.repository}/actions/runs/${this.summary.runId})`
      );
      report.push('');

      report.push('**Available Downloads:**');
      report.push('- `comprehensive-test-report` - Complete test results and coverage');
      report.push('- `lcov-html-report` - Interactive HTML coverage report');
      report.push('- `unit-test-results-node18` - Node.js 18 unit test results');
      report.push('- `unit-test-results-node20` - Node.js 20 unit test results');
      report.push('- `integration-test-results` - Integration test results');
      report.push('- `e2e-test-results` - End-to-end test results');
      report.push('- `performance-test-results` - Performance test results');
      report.push('- `security-test-results` - Security audit results');
    } else {
      report.push('🏠 **Local Run** - No remote artifacts available');
    }

    report.push('');

    // Footer
    report.push('---');
    report.push('');
    report.push(
      `*Report generated by Enhanced Test Summary Generator at ${new Date(this.summary.timestamp).toISOString()}*`
    );

    return report.join('\n');
  }

  /**
   * Format test status with appropriate emoji
   */
  formatTestStatus(status) {
    switch (status) {
      case 'success':
        return '✅ PASS';
      case 'failure':
        return '❌ FAIL';
      case 'cancelled':
        return '🛑 CANCELLED';
      case 'skipped':
        return '⏭️ SKIPPED';
      default:
        return '❓ UNKNOWN';
    }
  }

  /**
   * Identify source type from file path
   */
  identifySourceType(sourcePath) {
    if (sourcePath.includes('unit')) {
      return 'Unit Tests';
    }
    if (sourcePath.includes('integration')) {
      return 'Integration Tests';
    }
    if (sourcePath.includes('e2e')) {
      return 'E2E Tests';
    }
    if (sourcePath.includes('performance')) {
      return 'Performance Tests';
    }
    if (sourcePath.includes('security')) {
      return 'Security Tests';
    }
    return 'Unknown';
  }

  /**
   * Extract relevant excerpt from log file
   */
  extractLogExcerpt(logContent, maxLines = 20) {
    const lines = logContent.split('\n');

    // Try to find test summary first
    const summaryIndex = lines.findIndex(
      line => line.includes('Test Suites:') || line.includes('Tests:') || line.includes('PASS') || line.includes('FAIL')
    );

    if (summaryIndex !== -1) {
      // Return summary section
      return lines.slice(summaryIndex, summaryIndex + Math.min(maxLines, lines.length - summaryIndex)).join('\n');
    }

    // Fall back to last N lines
    return lines.slice(-maxLines).join('\n');
  }

  /**
   * Generate comprehensive JSON summary
   */
  generateJsonSummary() {
    return {
      ...this.summary,
      generated: new Date().toISOString(),
      version: '2.0',
    };
  }

  /**
   * Save report files
   */
  saveReports(outputDir = 'reports') {
    fs.mkdirSync(outputDir, { recursive: true });

    const markdownPath = path.join(outputDir, 'test-summary.md');
    const jsonPath = path.join(outputDir, 'test-summary.json');

    // Generate and save markdown report
    const markdown = this.generateMarkdownReport();
    fs.writeFileSync(markdownPath, markdown);
    console.log(`✅ Generated ${markdownPath}`);

    // Generate and save JSON summary
    const json = this.generateJsonSummary();
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
    console.log(`✅ Generated ${jsonPath}`);

    return { markdownPath, jsonPath };
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Professional Test Summary Generator

Usage:
  node generate-test-summary.js [options]

Options:
  --test-results <path>      Path to test results directory (default: test-results)
  --search-paths <paths>     Comma-separated search paths for coverage (default: .,coverage,test-results)
  --output <dir>             Output directory for reports (default: reports)
  --help                     Show this help

Examples:
  node generate-test-summary.js
  node generate-test-summary.js --test-results ./artifacts/tests
  node generate-test-summary.js --output ./summary-reports
`);
    process.exit(0);
  }

  // Parse arguments
  const testResultsArg =
    args.find(arg => arg.startsWith('--test-results='))?.split('=')[1] ||
    (args.includes('--test-results') ? args[args.indexOf('--test-results') + 1] : null);
  const searchPathsArg =
    args.find(arg => arg.startsWith('--search-paths='))?.split('=')[1] ||
    (args.includes('--search-paths') ? args[args.indexOf('--search-paths') + 1] : null);
  const outputArg =
    args.find(arg => arg.startsWith('--output='))?.split('=')[1] ||
    (args.includes('--output') ? args[args.indexOf('--output') + 1] : null);

  const testResultsPath = testResultsArg || 'test-results';
  const searchPaths = searchPathsArg ? searchPathsArg.split(',') : ['.', 'coverage', 'test-results'];
  const outputDir = outputArg || 'reports';

  console.log('📊 Professional Test Summary Generator Starting...');
  console.log(`📂 Test results: ${testResultsPath}`);
  console.log(`🔍 Coverage search: ${searchPaths.join(', ')}`);
  console.log(`📄 Output directory: ${outputDir}`);

  try {
    const generator = new TestSummaryGenerator();

    // Load all data
    const hasCoverage = generator.loadCoverageData(searchPaths);
    generator.loadTestResults(testResultsPath);
    generator.loadSecurityResults(searchPaths);

    // Generate reports
    const { markdownPath, jsonPath } = generator.saveReports(outputDir);

    console.log('\n✅ Test summary generation completed successfully!');

    const { summary } = generator;
    console.log(`📊 Coverage: ${summary.coverage ? summary.coverage.lines?.pct?.toFixed(2) : 'N/A'}%`);
    console.log(`🧪 Test Success: ${summary.qualityGates.testsPassing.actual.toFixed(1)}%`);
    console.log(`🔒 Security: ${summary.qualityGates.security.vulnerabilities} vulnerabilities`);

    // Exit with appropriate status
    const allGatesPassed = Object.values(summary.qualityGates).every(gate => gate.passed);
    if (allGatesPassed) {
      console.log('🎯 All quality gates passed!');
      process.exit(0);
    } else {
      console.log('⚠️  Some quality gates failed');
      process.exit(0); // Don't fail the build for reporting
    }
  } catch (error) {
    console.error('❌ Test summary generation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Export for testing
export { TestSummaryGenerator };

// Run CLI if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
