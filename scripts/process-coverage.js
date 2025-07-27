#!/usr/bin/env node

/**
 * Process merged coverage files and generate coverage summary
 * Replaces error-prone shell arithmetic with reliable JavaScript
 */

import fs from 'fs/promises';
import { execSync } from 'child_process';

async function processLcovFile(lcovPath) {
  try {
    const content = await fs.readFile(lcovPath, 'utf8');

    // Parse LCOV data
    const metrics = {
      lines: { found: 0, hit: 0 },
      functions: { found: 0, hit: 0 },
      branches: { found: 0, hit: 0 },
    };

    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('LF:')) {
        metrics.lines.found += parseInt(line.split(':')[1]) || 0;
      } else if (line.startsWith('LH:')) {
        metrics.lines.hit += parseInt(line.split(':')[1]) || 0;
      } else if (line.startsWith('FNF:')) {
        metrics.functions.found += parseInt(line.split(':')[1]) || 0;
      } else if (line.startsWith('FNH:')) {
        metrics.functions.hit += parseInt(line.split(':')[1]) || 0;
      } else if (line.startsWith('BRF:')) {
        metrics.branches.found += parseInt(line.split(':')[1]) || 0;
      } else if (line.startsWith('BRH:')) {
        metrics.branches.hit += parseInt(line.split(':')[1]) || 0;
      }
    }

    // Calculate percentages safely
    const calculatePercentage = (hit, found) => {
      if (found === 0) {
        return 0.0;
      }
      return parseFloat(((hit / found) * 100).toFixed(2));
    };

    const coverageData = {
      lines: {
        total: metrics.lines.found,
        covered: metrics.lines.hit,
        pct: calculatePercentage(metrics.lines.hit, metrics.lines.found),
      },
      functions: {
        total: metrics.functions.found,
        covered: metrics.functions.hit,
        pct: calculatePercentage(metrics.functions.hit, metrics.functions.found),
      },
      branches: {
        total: metrics.branches.found,
        covered: metrics.branches.hit,
        pct: calculatePercentage(metrics.branches.hit, metrics.branches.found),
      },
    };

    console.log(`📈 Coverage Metrics:`);
    console.log(`  Lines: ${coverageData.lines.covered}/${coverageData.lines.total} (${coverageData.lines.pct}%)`);
    console.log(
      `  Functions: ${coverageData.functions.covered}/${coverageData.functions.total} (${coverageData.functions.pct}%)`
    );
    console.log(
      `  Branches: ${coverageData.branches.covered}/${coverageData.branches.total} (${coverageData.branches.pct}%)`
    );

    return coverageData;
  } catch (error) {
    console.error(`❌ Error processing LCOV file: ${error.message}`);
    return null;
  }
}

async function generateCoverageSummary(coverageFiles, coverageData) {
  const summary = {
    total: {
      lines: {
        total: coverageData.lines.total,
        covered: coverageData.lines.covered,
        pct: coverageData.lines.pct,
      },
      statements: {
        total: coverageData.lines.total,
        covered: coverageData.lines.covered,
        pct: coverageData.lines.pct,
      },
      functions: {
        total: coverageData.functions.total,
        covered: coverageData.functions.covered,
        pct: coverageData.functions.pct,
      },
      branches: {
        total: coverageData.branches.total,
        covered: coverageData.branches.covered,
        pct: coverageData.branches.pct,
      },
    },
    merged_from: coverageFiles,
  };

  await fs.writeFile('coverage-summary.json', JSON.stringify(summary, null, 2));
  console.log('✅ Generated coverage-summary.json');

  return summary;
}

async function setGitHubOutputs(coverageData) {
  const githubOutput = process.env.GITHUB_OUTPUT;

  if (githubOutput) {
    await fs.appendFile(githubOutput, `coverage_pct=${coverageData.lines.pct}\n`);
    await fs.appendFile(githubOutput, `status=available\n`);
    await fs.appendFile(githubOutput, `lines_total=${coverageData.lines.total}\n`);
    await fs.appendFile(githubOutput, `lines_covered=${coverageData.lines.covered}\n`);
    console.log('✅ Set GitHub Actions outputs');
  } else {
    console.log(`coverage_pct=${coverageData.lines.pct}`);
    console.log(`status=available`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mergedLcovPath = args[0] || 'coverage/merged/lcov.info';
  const coverageFilesArg = args[1] || '';

  console.log(`🔍 Processing coverage file: ${mergedLcovPath}`);

  // Check if merged file exists
  try {
    await fs.access(mergedLcovPath);
  } catch (error) {
    console.error(`❌ Merged LCOV file not found: ${mergedLcovPath}`);
    process.exit(1);
  }

  // Process the merged coverage file
  const coverageData = await processLcovFile(mergedLcovPath);

  if (!coverageData) {
    console.error('❌ Failed to process coverage data');
    process.exit(1);
  }

  // Parse coverage files list
  const coverageFiles = coverageFilesArg ? coverageFilesArg.split(',') : [];

  // Generate coverage summary
  await generateCoverageSummary(coverageFiles, coverageData);

  // Set GitHub Actions outputs
  await setGitHubOutputs(coverageData);

  console.log('✅ Coverage processing completed successfully');
}

// Run the script
main().catch(error => {
  console.error('❌ Coverage processing failed:', error);
  process.exit(1);
});
