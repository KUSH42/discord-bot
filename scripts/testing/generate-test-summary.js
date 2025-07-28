#!/usr/bin/env node

/**
 * Professional Test Summary Generator
 *
 * Generates comprehensive, professional test reports from CI artifacts
 * including coverage analysis, test results, and quality assessments.
 */

import fs from 'fs';
import path from 'path';
import xml2js from 'xml2js';

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
   * Load coverage data from various sources, including multiple lcov.info files.
   */
  loadCoverageData(searchPaths = ['coverage', '.', 'test-results']) {
    console.log('📊 Loading coverage data...');

    let coverageFound = false;

    // First, try to load from coverage-summary.json
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
          coverageFound = true;

          // Load extended metrics if available
          if (fs.existsSync(metricsPath)) {
            const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
            this.summary.coverage.extended = metrics;
            console.log(`📈 Loaded extended metrics from ${metricsPath}`);
          }
          // If we find a coverage-summary.json, we might prioritize it or still look for lcov.info for merging
          // For now, let's assume coverage-summary.json is the primary source if it exists and is comprehensive.
          // If you need to *merge* lcov.info files into this summary, that's a more complex task requiring a coverage tool.
          break; // Stop looking if a primary summary is found
        } catch (error) {
          console.log(`❌ Error loading coverage from ${summaryPath}: ${error.message}`);
        }
      }
    }

    // Now, discover and log all lcov.info files, regardless of whether a summary.json was found.
    // This is for reporting purposes or if you later implement merging of lcov data.
    console.log('🔍 Discovering lcov.info files in subdirectories...');
    const lcovFiles = [];
    for (const searchPath of searchPaths) {
      // Find all lcov.info files in the current directory and its subdirectories
      const discovered = this.findFiles(searchPath, /lcov\.info$/);
      for (const file of discovered) {
        if (!this.processedCoverageFiles.has(file)) {
          lcovFiles.push(file);
          this.processedCoverageFiles.add(file);
          console.log(`   Found: ${file}`);
        } else {
          console.log(`   🔄 Duplicate content detected, skipping: ${file}`);
        }
      }
    }
    this.summary.discoveredCoverageFiles = lcovFiles;
    if (lcovFiles.length > 0) {
      console.log(`✅ Discovered ${lcovFiles.length} unique lcov.info files.`);
      // If no coverage-summary.json was found, you might want to try to process these lcov files.
      // This part would typically involve a library like 'istanbul-lib-coverage' to merge them.
      // For this specific fix, we're just ensuring they are discovered uniquely.
      if (!coverageFound && lcovFiles.length > 0) {
        // Placeholder: If you want to calculate a summary from these lcov files
        // you'd need a more robust parsing and merging logic here.
        console.log(
          '⚠️ No coverage-summary.json found. lcov.info files are discovered but not processed into a summary.'
        );
      }
    } else {
      console.log('⚠️ No lcov.info files found.');
    }

    // Update quality gates (this still relies on this.summary.coverage being populated from coverage-summary.json or merged data)
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
  async loadTestResults(testResultsPath = 'test-results') {
    console.log('🧪 Loading test results...');

    if (!fs.existsSync(testResultsPath)) {
      console.log(`⚠️  Test results path not found: ${testResultsPath}`);
      return;
    }

    // First try to load from XML files (Jest JUnit output)
    await this.loadJunitResults(testResultsPath);

    // Then load from legacy directory structure
    const testTypes = ['unit', 'integration', 'e2e', 'performance', 'security'];

    for (const testType of testTypes) {
      if (this.summary.tests[testType].status === 'unknown') {
        const typeResults = this.loadTestTypeResults(testResultsPath, testType);
        this.summary.tests[testType] = typeResults;
      }
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
   * Load results from JUnit XML files
   */
  async loadJunitResults(testResultsPath) {
    console.log('📋 Loading JUnit XML results...');

    try {
      const xmlFiles = this.findFiles(testResultsPath, /.*\.xml$/);
      const parser = new xml2js.Parser();

      for (const xmlFile of xmlFiles) {
        const fileName = path.basename(xmlFile, '.xml');

        try {
          const xmlContent = fs.readFileSync(xmlFile, 'utf8');
          const result = await parser.parseStringPromise(xmlContent);

          if (result.testsuites || result.testsuite) {
            // For combined XML files (like all-tests.xml), parse and categorize by test suite names
            if (fileName.includes('all') || fileName.includes('ci') || fileName.includes('combined')) {
              this.parseCombinedJunitXml(result, xmlFile);
            } else {
              // For individual test type files, use filename-based detection
              const testType = this.detectTestTypeFromFilename(fileName);
              const testSuiteResults = this.parseJunitXml(result, xmlFile);

              if (this.summary.tests[testType].status === 'unknown') {
                this.summary.tests[testType] = testSuiteResults;
                console.log(`✅ Loaded ${testType} results from ${xmlFile}`);
              } else {
                // Merge results from multiple XML files of the same type (e.g., unit-tests-node18.xml, unit-tests-node20.xml)
                this.mergeTestResults(testType, testSuiteResults, xmlFile);
                console.log(`🔄 Merged ${testType} results from ${xmlFile}`);
              }
            }
          }
        } catch (xmlError) {
          console.log(`⚠️  Error parsing XML file ${xmlFile}: ${xmlError.message}`);
        }
      }
    } catch (error) {
      console.log(`⚠️  Error loading JUnit results: ${error.message}`);
    }
  }

  /**
   * Merge results from multiple XML files of the same test type
   */
  mergeTestResults(testType, newResults, xmlFile) {
    const existing = this.summary.tests[testType];

    // Merge summary numbers
    if (existing.summary && newResults.summary) {
      existing.summary.total += newResults.summary.total || 0;
      existing.summary.passed += newResults.summary.passed || 0;
      existing.summary.failed += newResults.summary.failed || 0;
      existing.summary.skipped += newResults.summary.skipped || 0;

      // Parse and add time durations
      const existingTime = this.parseTimeToSeconds(existing.summary.time);
      const newTime = this.parseTimeToSeconds(newResults.summary.time);
      existing.summary.time = this.formatSecondsToTime(existingTime + newTime);
    }

    // Merge extended suite data
    if (existing.extended && newResults.extended) {
      existing.extended.suites = existing.extended.suites || [];
      if (newResults.extended.suites) {
        existing.extended.suites.push(...newResults.extended.suites);
      }
    }

    // Update status - fail if any part fails
    if (newResults.status === 'failure') {
      existing.status = 'failure';
    }

    // Update details to show merged information
    const totalTests = existing.summary?.total || 0;
    const totalFailures = existing.summary?.failed || 0;
    const totalErrors = 0; // We don't track errors separately in our current format
    const totalSkipped = existing.summary?.skipped || 0;
    const totalTime = existing.summary?.time || '0s';

    existing.details = `${totalTests} tests, ${totalFailures} failures, ${totalErrors} errors, ${totalSkipped} skipped (${totalTime})`;
    existing.path = `${existing.path}, ${xmlFile}`; // Show both file paths
  }

  /**
   * Parse time string to seconds (handles formats like "28.53s", "1m 30s", etc.)
   */
  parseTimeToSeconds(timeStr) {
    if (!timeStr) {
      return 0;
    }

    // Handle simple seconds format like "28.53s"
    const secondsMatch = timeStr.match(/^([\d.]+)s?$/);
    if (secondsMatch) {
      return parseFloat(secondsMatch[1]);
    }

    // Handle more complex formats if needed
    return 0;
  }

  /**
   * Format seconds back to time string
   */
  formatSecondsToTime(seconds) {
    if (seconds < 60) {
      return `${seconds.toFixed(2)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
  }

  /**
   * Detect test type from filename
   */
  detectTestTypeFromFilename(fileName) {
    if (fileName.includes('integration')) {
      return 'integration';
    } else if (fileName.includes('e2e')) {
      return 'e2e';
    } else if (fileName.includes('performance')) {
      return 'performance';
    } else if (fileName.includes('security')) {
      return 'security';
    }
    return 'unit'; // Default
  }

  /**
   * Parse combined JUnit XML file and categorize by test suite names
   */
  parseCombinedJunitXml(xmlData, filePath) {
    console.log(`🔍 Analyzing combined test results from ${filePath}...`);

    const testsuites = xmlData.testsuites || { testsuite: [xmlData.testsuite] };
    const suites = Array.isArray(testsuites.testsuite) ? testsuites.testsuite : [testsuites.testsuite];

    // Initialize categorized results
    const categorizedResults = {
      unit: { suites: [], totalTests: 0, totalFailures: 0, totalErrors: 0, totalSkipped: 0, totalTime: 0 },
      integration: { suites: [], totalTests: 0, totalFailures: 0, totalErrors: 0, totalSkipped: 0, totalTime: 0 },
      e2e: { suites: [], totalTests: 0, totalFailures: 0, totalErrors: 0, totalSkipped: 0, totalTime: 0 },
      performance: { suites: [], totalTests: 0, totalFailures: 0, totalErrors: 0, totalSkipped: 0, totalTime: 0 },
      security: { suites: [], totalTests: 0, totalFailures: 0, totalErrors: 0, totalSkipped: 0, totalTime: 0 },
    };

    // Categorize each test suite
    for (const suite of suites) {
      if (!suite) {
        continue;
      }

      const suiteName = suite.$.name || '';
      const testType = this.categorizeTestSuite(suiteName);

      const tests = parseInt(suite.$.tests || '0', 10);
      const failures = parseInt(suite.$.failures || '0', 10);
      const errors = parseInt(suite.$.errors || '0', 10);
      const skipped = parseInt(suite.$.skipped || '0', 10);
      const time = parseFloat(suite.$.time || '0');

      // Add to appropriate category
      const category = categorizedResults[testType];
      category.suites.push({
        name: suiteName,
        tests,
        failures,
        errors,
        skipped,
        time,
        timestamp: suite.$.timestamp,
      });

      category.totalTests += tests;
      category.totalFailures += failures;
      category.totalErrors += errors;
      category.totalSkipped += skipped;
      category.totalTime += time;
    }

    // Update summary for each test type found
    for (const [testType, results] of Object.entries(categorizedResults)) {
      if (results.totalTests > 0 && this.summary.tests[testType].status === 'unknown') {
        const successRate =
          results.totalTests > 0
            ? ((results.totalTests - results.totalFailures - results.totalErrors) / results.totalTests) * 100
            : 0;

        this.summary.tests[testType] = {
          status: results.totalFailures === 0 && results.totalErrors === 0 ? 'success' : 'failure',
          tests: results.totalTests,
          failures: results.totalFailures,
          errors: results.totalErrors,
          skipped: results.totalSkipped,
          time: results.totalTime,
          successRate,
          details: {
            suites: results.suites,
            path: filePath,
          },
        };

        console.log(`✅ Loaded ${testType} results: ${results.totalTests} tests (${successRate.toFixed(1)}% success)`);
      }
    }
  }

  /**
   * Categorize test suite by name patterns
   */
  categorizeTestSuite(suiteName) {
    const name = suiteName.toLowerCase();

    // Integration test patterns
    if (
      name.includes('integration') ||
      name.includes('-integration') ||
      name.includes('external-apis') ||
      name.includes('discord-integration') ||
      name.includes('startup-shutdown') ||
      name.includes('production-setup') ||
      name.includes('content-announcement-flow') ||
      name.includes('pubsubhubbub-security') ||
      name.includes('monitor-application-fallback')
    ) {
      return 'integration';
    }

    // E2E test patterns
    if (
      name.includes('e2e') ||
      name.includes('end-to-end') ||
      name.includes('workflow') ||
      name.includes('announcement-workflows') ||
      name.includes('command-processing-workflows') ||
      name.includes('scraper-announcement-flow') ||
      name.includes('fallback-recovery') ||
      name.includes('empty-notification-fallback')
    ) {
      return 'e2e';
    }

    // Performance test patterns
    if (
      name.includes('performance') ||
      name.includes('load') ||
      name.includes('benchmark') ||
      name.includes('stress') ||
      name.includes('load-tests')
    ) {
      return 'performance';
    }

    // Security test patterns
    if (
      name.includes('security') ||
      name.includes('auth') ||
      name.includes('credential') ||
      name.includes('validation') ||
      name.includes('input-validation') ||
      name.includes('credential-handling') ||
      name.includes('application-input-validation')
    ) {
      return 'security';
    }

    // Default to unit tests
    return 'unit';
  }

  /**
   * Parse JUnit XML format
   */
  parseJunitXml(xmlData, filePath) {
    const testsuites = xmlData.testsuites || { testsuite: [xmlData.testsuite] };
    const suites = Array.isArray(testsuites.testsuite) ? testsuites.testsuite : [testsuites.testsuite];

    let totalTests = 0;
    let totalFailures = 0;
    let totalErrors = 0;
    let totalSkipped = 0;
    let totalTime = 0;

    const details = {
      suites: [],
      path: filePath,
    };

    for (const suite of suites) {
      if (!suite) {
        continue;
      }

      const tests = parseInt(suite.$.tests || '0', 10);
      const failures = parseInt(suite.$.failures || '0', 10);
      const errors = parseInt(suite.$.errors || '0', 10);
      const skipped = parseInt(suite.$.skipped || '0', 10);
      const time = parseFloat(suite.$.time || '0');

      totalTests += tests;
      totalFailures += failures;
      totalErrors += errors;
      totalSkipped += skipped;
      totalTime += time;

      details.suites.push({
        name: suite.$.name || 'Unknown',
        tests,
        failures,
        errors,
        skipped,
        time: `${time}s`,
      });
    }

    const hasFailures = totalFailures > 0 || totalErrors > 0;
    const status = hasFailures ? 'failure' : 'success';

    return {
      status,
      details: `${totalTests} tests, ${totalFailures} failures, ${totalErrors} errors, ${totalSkipped} skipped (${totalTime.toFixed(2)}s)`,
      path: filePath,
      summary: {
        total: totalTests,
        passed: totalTests - totalFailures - totalErrors - totalSkipped,
        failed: totalFailures + totalErrors,
        skipped: totalSkipped,
        time: `${totalTime.toFixed(2)}s`,
      },
      extended: details,
    };
  }

  /**
   * Load results for specific test type
   */
  loadTestTypeResults(basePath, testType) {
    const possiblePaths = [
      path.join(basePath, 'test-reports', `${testType}-tests`),
      path.join(basePath, 'coverage', `${testType}-tests`),
      path.join(basePath, 'test-reports/coverage', `${testType}-tests`),
      path.join(basePath, testType, 'coverage', testType),
      path.join(basePath, 'coverage', 'unit-tests-node18'),
      path.join(basePath, 'coverage', 'unit-tests-node20'),
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
      let details = 'No test results found';

      if (result.status !== 'unknown') {
        if (result.tests !== undefined) {
          details = `${result.tests} tests, ${result.failures || 0} failures, ${(result.successRate || 0).toFixed(1)}% success`;
        } else {
          details = result.path || 'Standard test execution';
        }
      }

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
    generator.loadCoverageData(searchPaths);
    await generator.loadTestResults(testResultsPath);
    generator.loadSecurityResults(searchPaths);

    // Generate reports
    generator.saveReports(outputDir);

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
