#!/usr/bin/env node

/**
 * Generate comprehensive test report for CI
 * Replaces complex shell script with reliable Node.js implementation
 */

import fs from 'fs/promises';
import { nowUTC, toISOStringUTC } from '../src/utilities/utc-time.js';

const GITHUB_SHA = process.env.GITHUB_SHA || 'unknown';
const GITHUB_REF_NAME = process.env.GITHUB_REF_NAME || 'unknown';
const GITHUB_EVENT_NAME = process.env.GITHUB_EVENT_NAME || 'unknown';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'unknown/unknown';
const GITHUB_RUN_ID = process.env.GITHUB_RUN_ID || 'unknown';

async function readJsonFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Could not read ${filePath}:`, error.message);
    return null;
  }
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    console.warn(`Could not read ${filePath}:`, error.message);
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function formatPercentage(value) {
  const num = parseFloat(value) || 0;
  return num.toFixed(2);
}

function parseTestStatistics(logContent) {
  if (!logContent) {
    return { passed: 0, failed: 0, total: 0, suites: 0 };
  }

  // Look for Jest summary first
  const jestSummaryMatch = logContent.match(/Test Suites:.*\n.*Tests:.*\n.*Snapshots:/s);
  if (jestSummaryMatch) {
    const summary = jestSummaryMatch[0];
    const passed = (summary.match(/(\d+) passed/) || [0, 0])[1];
    const failed = (summary.match(/(\d+) failed/) || [0, 0])[1];
    const total = (summary.match(/Tests:.*?(\d+) total/) || [0, 0])[1];
    const suites = (summary.match(/Test Suites:.*?(\d+) total/) || [0, 0])[1];

    return {
      passed: parseInt(passed) || 0,
      failed: parseInt(failed) || 0,
      total: parseInt(total) || 0,
      suites: parseInt(suites) || 0,
    };
  }

  // Fallback to pattern matching
  const passedMatches = logContent.match(/✓/g) || [];
  const failedMatches = logContent.match(/✗|FAIL/g) || [];
  const suiteMatches = logContent.match(/describe|Test Suites:/g) || [];

  return {
    passed: passedMatches.length,
    failed: failedMatches.length,
    total: passedMatches.length + failedMatches.length,
    suites: suiteMatches.length,
  };
}

async function getTestResults() {
  const testTypes = ['unit', 'integration', 'e2e', 'performance', 'security'];
  const results = {};

  // Get job results from environment variables (would be passed from workflow)
  const jobResults = {
    unit: process.env.UNIT_TESTS_RESULT || 'success',
    integration: process.env.INTEGRATION_TESTS_RESULT || 'success',
    e2e: process.env.E2E_TESTS_RESULT || 'success',
    performance: process.env.PERFORMANCE_TESTS_RESULT || 'success',
    security: process.env.SECURITY_TESTS_RESULT || 'success',
  };

  for (const testType of testTypes) {
    results[testType] = {
      status: jobResults[testType],
      statistics: { passed: 0, failed: 0, total: 0, suites: 0 },
    };

    // Read test output files
    const outputFiles = [];
    if (testType === 'unit') {
      const node18Log = 'test-results/unit/node18/coverage/unit/test-output-node18.log';
      const node20Log = 'test-results/unit/node20/coverage/unit/test-output-node20.log';
      if (await fileExists(node18Log)) {
        outputFiles.push(node18Log);
      }
      if (await fileExists(node20Log)) {
        outputFiles.push(node20Log);
      }
    } else {
      const logPath1 = `test-results/${testType}/coverage/${testType}/test-output.log`;
      const logPath2 = `test-results/${testType}/test-output.log`;
      if (await fileExists(logPath1)) {
        outputFiles.push(logPath1);
      } else if (await fileExists(logPath2)) {
        outputFiles.push(logPath2);
      }
    }

    // Parse statistics from log files
    const totalStats = { passed: 0, failed: 0, total: 0, suites: 0 };
    for (const logFile of outputFiles) {
      const logContent = await readTextFile(logFile);
      const stats = parseTestStatistics(logContent);
      totalStats.passed += stats.passed;
      totalStats.failed += stats.failed;
      totalStats.total += stats.total;
      totalStats.suites += stats.suites;
    }

    results[testType].statistics = totalStats;
    results[testType].outputFiles = outputFiles;
  }

  return results;
}

function getCoverageQuality(coverage) {
  const pct = parseFloat(coverage) || 0;
  if (pct >= 50) {
    return { emoji: '✅', text: 'Meets minimum standards (≥50%)' };
  }
  if (pct >= 25) {
    return { emoji: '⚠️', text: 'Below target but acceptable (≥25%)' };
  }
  return { emoji: '❌', text: 'Below minimum standards (<25%)' };
}

function getStatusEmoji(status) {
  switch (status) {
    case 'success':
      return '✅ Pass';
    case 'failure':
      return '❌ Fail';
    case 'cancelled':
      return '🛑 Cancel';
    default:
      return '⚠️ Unknown';
  }
}

async function generateReport() {
  await fs.mkdir('reports', { recursive: true });

  // Read coverage data
  const coverageSummary = await readJsonFile('coverage-summary.json');
  const overallCoverage = coverageSummary?.total?.lines?.pct || 0;
  const branchCoverage = coverageSummary?.total?.branches?.pct || 0;
  const functionCoverage = coverageSummary?.total?.functions?.pct || 0;
  const mergedFrom = coverageSummary?.merged_from || [];

  // Get test results
  const testResults = await getTestResults();

  // Calculate overall statistics
  let totalTests = 0,
    totalPassed = 0,
    totalFailed = 0,
    totalSuites = 0;
  Object.values(testResults).forEach(result => {
    totalTests += result.statistics.total;
    totalPassed += result.statistics.passed;
    totalFailed += result.statistics.failed;
    totalSuites += result.statistics.suites;
  });

  // Check if LCOV report exists
  const hasLcovReport = await fileExists('lcov-html-report');

  // Generate detailed results section
  const detailedResults = await Promise.all(
    Object.entries(testResults).map(async ([type, result]) => {
      let content = `### ${type.charAt(0).toUpperCase() + type.slice(1)} Tests\n\n` + '```\n';

      if (result.outputFiles.length > 0) {
        const fileContents = await Promise.all(
          result.outputFiles.map(async file => {
            const fileContent = await readTextFile(file);
            return `=== ${file} ===\n${fileContent || 'No output available'}`;
          })
        );
        content += fileContents.join('\n\n---\n\n');
      } else {
        content += `No output for ${type} tests`;
      }

      content += '\n' + '```';
      return content;
    })
  );

  // Generate report content
  const report = `# Test Summary Report

**Generated:** ${toISOStringUTC(nowUTC())}
**Commit:** \`${GITHUB_SHA}\`
**Branch:** \`${GITHUB_REF_NAME}\`
**Trigger:** ${GITHUB_EVENT_NAME}

## 🎯 Overall Merged Coverage: ${formatPercentage(overallCoverage)}%
*This is the true merged coverage from ${mergedFrom.length} test suite(s): ${mergedFrom.map(f => f.split('/').pop().replace('.info', '')).join(', ') || 'unit tests'}*

---

## Test Suite Status

| Test Type   | Result  |
|-------------|---------|
${Object.entries(testResults)
  .filter(([_, result]) => result.status !== 'skipped')
  .map(
    ([type, result]) =>
      `| ${type.charAt(0).toUpperCase() + type.slice(1).padEnd(10)} | ${getStatusEmoji(result.status).padEnd(7)} |`
  )
  .join('\n')}

${
  hasLcovReport
    ? `
## 📊 Detailed LCOV Coverage Report
You can find a detailed HTML coverage report as a workflow artifact: [LCOV HTML Report Artifact](https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts/lcov-html-report)
`
    : ''
}

## 📊 Test Statistics

${Object.entries(testResults)
  .filter(([_, result]) => result.statistics.total > 0)
  .map(([type, result]) => {
    const stats = result.statistics;
    const emoji = stats.failed > 0 ? '❌' : '✅';
    return `**${type.charAt(0).toUpperCase() + type.slice(1)} Tests:** ${emoji} ${stats.passed} passed, ${stats.failed} failed (${stats.total} total, ${stats.suites} suites)`;
  })
  .join('\n\n')}

${
  totalTests > 0
    ? `
**Overall:** ${totalFailed > 0 ? '❌' : '✅'} ${totalPassed} passed, ${totalFailed} failed (${totalTests} total tests across ${totalSuites} suites)
`
    : ''
}

## Detailed Results

${detailedResults.join('\n\n')}

## Detailed test results and coverage reports are available in the individual test artifacts:
- \`unit-test-results-node18\`, \`unit-test-results-node20\`
- \`integration-test-results\`
- \`e2e-test-results\`
- \`performance-test-results\`
- \`security-test-results\`

${
  coverageSummary
    ? `
## Merged Coverage Breakdown

- **Lines:** ${formatPercentage(overallCoverage)}%
- **Branches:** ${formatPercentage(branchCoverage)}%
- **Functions:** ${formatPercentage(functionCoverage)}%

${(() => {
  const quality = getCoverageQuality(overallCoverage);
  return `${quality.emoji} **Coverage Quality:** ${quality.text}`;
})()}

### Coverage Sources Merged
${mergedFrom.length > 0 ? mergedFrom.map(f => `- \`${f}\``).join('\n') : '- No source files information available'}
`
    : ''
}`;

  await fs.writeFile('reports/test-summary.md', report);
  console.log('✅ Test report generated successfully at reports/test-summary.md');

  // Also generate coverage metrics for validation
  const coverageMetrics = {
    timestamp: toISOStringUTC(nowUTC()),
    commit: GITHUB_SHA,
    branch: GITHUB_REF_NAME,
    coverage: {
      lines: parseFloat(formatPercentage(overallCoverage)),
      branches: parseFloat(formatPercentage(branchCoverage)),
      functions: parseFloat(formatPercentage(functionCoverage)),
      statements: parseFloat(formatPercentage(overallCoverage)),
    },
    qualityScore:
      parseFloat(formatPercentage(overallCoverage)) * 0.4 +
      parseFloat(formatPercentage(branchCoverage)) * 0.3 +
      parseFloat(formatPercentage(functionCoverage)) * 0.3,
    tests: {
      total: totalTests,
      passed: totalPassed,
      failed: totalFailed,
      suites: totalSuites,
    },
  };

  await fs.writeFile('coverage-metrics.json', JSON.stringify(coverageMetrics, null, 2));
  console.log('✅ Coverage metrics generated at coverage-metrics.json');

  // Set GitHub outputs for coverage validation
  const coverageStatus = overallCoverage >= 50 ? 'good' : overallCoverage >= 25 ? 'warning' : 'critical';

  // Set GitHub outputs using environment files (modern approach)
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(githubOutput, `coverage_pct=${formatPercentage(overallCoverage)}\n`);
    await fs.appendFile(githubOutput, `coverage_status=${coverageStatus}\n`);
    await fs.appendFile(githubOutput, `status=available\n`);
  } else {
    // Fallback for local testing
    console.log(`coverage_pct=${formatPercentage(overallCoverage)}`);
    console.log(`coverage_status=${coverageStatus}`);
    console.log(`status=available`);
  }
}

// Run the script
generateReport().catch(error => {
  console.error('❌ Failed to generate test report:', error);
  process.exit(1);
});
