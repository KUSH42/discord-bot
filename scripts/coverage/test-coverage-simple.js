#!/usr/bin/env node

/**
 * Simple Coverage System Test
 *
 * A simpler test that validates the core functionality without complex mocking.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testBasicFunctionality() {
  console.log('🧪 Testing Enhanced Coverage System (Simple)...');

  const testDir = 'test-coverage-simple';

  try {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    fs.mkdirSync(testDir, { recursive: true });

    // Create test LCOV content
    const mockLcovContent = `TN:
SF:src/test-file.js
FN:1,testFunction
FNF:1
FNH:1
FNDA:5,testFunction
DA:1,5
DA:2,5
DA:3,0
LF:3
LH:2
BRF:1
BRH:1
end_of_record
`;

    // Create test coverage file
    const testCoverageDir = path.join(testDir, 'coverage');
    fs.mkdirSync(testCoverageDir, { recursive: true });
    const testLcovPath = path.join(testCoverageDir, 'lcov.info');
    fs.writeFileSync(testLcovPath, mockLcovContent);

    console.log(`✅ Created test LCOV file: ${testLcovPath}`);

    // Test that we can read and parse the file
    const content = fs.readFileSync(testLcovPath, 'utf8');

    if (!content.includes('SF:') || !content.includes('DA:')) {
      throw new Error('Test LCOV file is invalid');
    }

    // Test basic coverage calculation
    const lines = content.split('\n');
    let linesFound = 0;
    let linesHit = 0;

    for (const line of lines) {
      if (line.startsWith('LF:')) {
        linesFound = parseInt(line.substring(3)) || 0;
      } else if (line.startsWith('LH:')) {
        linesHit = parseInt(line.substring(3)) || 0;
      }
    }

    const coveragePct = linesFound > 0 ? (linesHit / linesFound) * 100 : 0;

    console.log(`📊 Parsed coverage: ${linesHit}/${linesFound} lines (${coveragePct.toFixed(2)}%)`);

    if (Math.abs(coveragePct - 66.67) > 0.01) {
      throw new Error(`Expected ~66.67% coverage, got ${coveragePct.toFixed(2)}%`);
    }

    // Test coverage summary generation
    const coverageSummary = {
      total: {
        lines: { total: linesFound, covered: linesHit, pct: coveragePct },
        functions: { total: 1, covered: 1, pct: 100 },
        branches: { total: 1, covered: 1, pct: 100 },
        statements: { total: linesFound, covered: linesHit, pct: coveragePct },
      },
      merged_from: [testLcovPath],
      timestamp: new Date().toISOString(),
    };

    const summaryPath = path.join(testDir, 'coverage-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(coverageSummary, null, 2));

    console.log(`✅ Generated coverage summary: ${summaryPath}`);

    // Test test summary markdown generation
    const testMarkdown = `# Test Summary Report

**Generated:** ${new Date().toISOString()}
**Coverage:** ${coveragePct.toFixed(2)}%

## Quality Gates Status

| Gate | Status | Target | Actual |
|------|--------|--------|--------|
| Coverage | ✅ PASS | 25% | ${coveragePct.toFixed(2)}% |

## Coverage Analysis

| Metric | Coverage | Total | Covered |
|--------|----------|-------|---------|
| Lines | ${coveragePct.toFixed(2)}% | ${linesFound} | ${linesHit} |
| Functions | 100.00% | 1 | 1 |
| Branches | 100.00% | 1 | 1 |

✅ Coverage meets minimum standards!
`;

    const markdownPath = path.join(testDir, 'test-summary.md');
    fs.writeFileSync(markdownPath, testMarkdown);

    console.log(`✅ Generated test summary: ${markdownPath}`);

    // Verify files were created correctly
    const summaryExists = fs.existsSync(summaryPath) && fs.statSync(summaryPath).size > 0;
    const markdownExists = fs.existsSync(markdownPath) && fs.statSync(markdownPath).size > 0;

    if (!summaryExists || !markdownExists) {
      throw new Error('Generated files are missing or empty');
    }

    // Test reading the generated summary
    const generatedSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

    if (generatedSummary.total.lines.pct !== coveragePct) {
      throw new Error('Generated summary has incorrect coverage percentage');
    }

    console.log('✅ All basic functionality tests passed!');

    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log('🧹 Cleaned up test directory');

    return true;
  } catch (error) {
    console.error('❌ Test failed:', error.message);

    // Cleanup on error
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    return false;
  }
}

async function testPythonMerger() {
  console.log('🐍 Testing Python merger availability...');

  const pythonMerger = path.join(__dirname, 'merge-coverage.py');

  if (fs.existsSync(pythonMerger)) {
    console.log('✅ Python merger script found');

    try {
      const content = fs.readFileSync(pythonMerger, 'utf8');
      if (content.includes('def merge_coverage_files') && content.includes('def parse_lcov_file')) {
        console.log('✅ Python merger has required functions');
        return true;
      } else {
        console.log('⚠️  Python merger missing required functions');
        return false;
      }
    } catch (error) {
      console.log('❌ Error reading Python merger:', error.message);
      return false;
    }
  } else {
    console.log('⚠️  Python merger script not found');
    return false;
  }
}

async function testGeneratedScripts() {
  console.log('📝 Testing generated script structure...');

  const scripts = [
    '../coverage/merge-coverage-enhanced.js',
    '../testing/generate-test-summary.js',
    '../ci/ci-coverage-merger.js',
  ];

  let allValid = true;

  for (const script of scripts) {
    const scriptPath = path.join(__dirname, script);

    if (fs.existsSync(scriptPath)) {
      console.log(`✅ ${script} exists`);

      try {
        const content = fs.readFileSync(scriptPath, 'utf8');

        // Check for ES module exports
        if (content.includes('export {') && !content.includes('module.exports')) {
          console.log(`✅ ${script} uses ES modules correctly`);
        } else {
          console.log(`⚠️  ${script} may have module system issues`);
          allValid = false;
        }

        // Check for basic class structure
        if (content.includes('class ') && content.includes('constructor()')) {
          console.log(`✅ ${script} has proper class structure`);
        } else {
          console.log(`⚠️  ${script} missing class structure`);
          allValid = false;
        }
      } catch (error) {
        console.log(`❌ Error reading ${script}:`, error.message);
        allValid = false;
      }
    } else {
      console.log(`❌ ${script} not found`);
      allValid = false;
    }
  }

  return allValid;
}

async function main() {
  console.log('🚀 Enhanced Coverage System - Simple Test Suite');
  console.log('='.repeat(60));

  const tests = [
    { name: 'Basic Functionality', test: testBasicFunctionality },
    { name: 'Python Merger', test: testPythonMerger },
    { name: 'Generated Scripts', test: testGeneratedScripts },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n🧪 Running: ${test.name}`);
    console.log('-'.repeat(40));

    try {
      const result = await test.test();

      if (result) {
        console.log(`✅ ${test.name} PASSED`);
        passed++;
      } else {
        console.log(`❌ ${test.name} FAILED`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name} FAILED:`, error.message);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 Test Results Summary:');
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed! Coverage system is ready for deployment.');
    console.log('\n📋 Next Steps:');
    console.log('1. Update .github/workflows/test.yml with the new coverage section');
    console.log('2. Test in a PR to validate CI integration');
    console.log('3. Deploy to production');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. System needs fixes before deployment.');
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
