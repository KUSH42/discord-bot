#!/usr/bin/env node

/**
 * CI Coverage Merger
 *
 * Specialized script for GitHub Actions to properly merge coverage from all test types
 * and generate professional reports. Designed to replace the flawed bash-based merging.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

class CICoverageMerger {
  constructor() {
    this.workingDir = process.cwd();
    this.testResults = 'test-results';
    this.outputDir = 'coverage';
    this.mergedDir = path.join(this.outputDir, 'merged');
    this.summary = {
      timestamp: new Date().toISOString(),
      totalFiles: 0,
      coverageByType: {},
      mergedCoverage: null,
      sources: [],
    };
  }

  /**
   * Main entry point for CI coverage merging
   */
  async run() {
    try {
      console.log('🚀 CI Enhanced Coverage Merger Starting...');
      console.log(`📂 Working directory: ${this.workingDir}`);
      console.log(`📊 Test results path: ${this.testResults}`);

      // Step 1: Install required tools
      await this.installTools();

      // Step 2: Discover coverage files
      const coverageFiles = this.discoverCoverageFiles();

      if (coverageFiles.length === 0) {
        console.log('❌ No coverage files found');
        this.createEmptyCoverage();
        process.exit(0);
      }

      console.log(`📊 Found ${coverageFiles.length} coverage files`);

      // Step 3: Merge coverage files
      await this.mergeCoverageFiles(coverageFiles);

      // Step 4: Generate comprehensive summary
      await this.generateComprehensiveSummary();

      // Step 5: Generate test summary report
      await this.generateTestSummary();

      console.log('✅ CI Coverage merging completed successfully!');

      // Output GitHub Actions variables
      this.setGitHubOutputs();
    } catch (error) {
      console.error('❌ CI Coverage merging failed:', error.message);
      console.error(error.stack);

      // Create fallback coverage for CI to continue
      this.createEmptyCoverage();
      process.exit(1);
    }
  }

  /**
   * Install necessary tools for coverage processing
   */
  async installTools() {
    console.log('🔧 Installing coverage tools...');

    try {
      // Check if lcov-result-merger is available
      execSync('npm list lcov-result-merger', { stdio: 'pipe' });
      console.log('✅ lcov-result-merger already available');
    } catch {
      try {
        console.log('📦 Installing lcov-result-merger...');
        execSync('npm install --no-save lcov-result-merger', { stdio: 'inherit' });
        console.log('✅ lcov-result-merger installed');
      } catch (error) {
        console.log('⚠️  Failed to install lcov-result-merger, will use fallback merger');
      }
    }
  }

  /**
   * Discover all coverage files from test results
   */
  discoverCoverageFiles() {
    console.log('🔍 Discovering coverage files...');

    const searchPaths = [
      // Unit test coverage (multiple Node versions)
      'test-results/unit/node18/coverage/unit/lcov.info',
      'test-results/unit/node20/coverage/unit/lcov.info',
      'test-results/unit-test-results-node18/coverage/unit/lcov.info',
      'test-results/unit-test-results-node20/coverage/unit/lcov.info',

      // Integration test coverage
      'test-results/integration/coverage/integration/lcov.info',
      'test-results/integration-test-results/coverage/integration/lcov.info',

      // E2E test coverage
      'test-results/e2e/coverage/e2e/lcov.info',
      'test-results/e2e-test-results/coverage/e2e/lcov.info',

      // Performance test coverage
      'test-results/performance/coverage/performance/lcov.info',
      'test-results/performance-test-results/coverage/performance/lcov.info',

      // Alternative paths
      'coverage/unit/lcov.info',
      'coverage/integration/lcov.info',
      'coverage/e2e/lcov.info',
      'coverage/performance/lcov.info',
      'coverage/lcov.info',
    ];

    const foundFiles = [];
    const seenHashes = new Set();

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        const content = fs.readFileSync(searchPath, 'utf8');

        // Skip empty or invalid files
        if (!content.includes('SF:') || !content.includes('DA:') || content.trim().length < 50) {
          console.log(`⚠️  Skipping invalid coverage file: ${searchPath}`);
          continue;
        }

        // Deduplicate based on content hash
        const hash = createHash('md5').update(content).digest('hex');

        if (!seenHashes.has(hash)) {
          seenHashes.add(hash);

          const testType = this.identifyTestType(searchPath);
          const nodeVersion = this.extractNodeVersion(searchPath);

          foundFiles.push({
            path: searchPath,
            type: testType,
            nodeVersion,
            size: content.length,
            hash: hash.substring(0, 8),
          });

          console.log(`✅ Found ${testType} coverage (Node ${nodeVersion}): ${searchPath}`);

          // Track coverage by type
          if (!this.summary.coverageByType[testType]) {
            this.summary.coverageByType[testType] = [];
          }
          this.summary.coverageByType[testType].push({
            path: searchPath,
            nodeVersion,
            size: content.length,
          });
        } else {
          console.log(`🔄 Duplicate content detected, skipping: ${searchPath}`);
        }
      }
    }

    this.summary.sources = foundFiles;
    return foundFiles;
  }

  /**
   * Identify test type from file path
   */
  identifyTestType(filePath) {
    if (filePath.includes('unit')) {
      return 'unit';
    }
    if (filePath.includes('integration')) {
      return 'integration';
    }
    if (filePath.includes('e2e')) {
      return 'e2e';
    }
    if (filePath.includes('performance')) {
      return 'performance';
    }
    if (filePath.includes('security')) {
      return 'security';
    }
    return 'unknown';
  }

  /**
   * Extract Node.js version from path
   */
  extractNodeVersion(filePath) {
    const nodeMatch = filePath.match(/node(\d+)/);
    return nodeMatch ? nodeMatch[1] : 'unknown';
  }

  /**
   * Merge coverage files using appropriate strategy
   */
  async mergeCoverageFiles(coverageFiles) {
    console.log('🔄 Merging coverage files...');

    // Create output directories
    fs.mkdirSync(this.mergedDir, { recursive: true });

    const outputLcov = path.join(this.mergedDir, 'lcov.info');
    const filePaths = coverageFiles.map(f => f.path);

    if (filePaths.length === 1) {
      // Single file - just copy
      fs.copyFileSync(filePaths[0], outputLcov);
      console.log(`📄 Single coverage file copied to ${outputLcov}`);
    } else {
      // Multiple files - merge them
      await this.mergeMultipleLcovFiles(filePaths, outputLcov);
    }

    // Validate merged file
    if (!fs.existsSync(outputLcov) || !this.isValidLcovFile(outputLcov)) {
      throw new Error('Failed to create valid merged coverage file');
    }

    console.log(`✅ Coverage merged successfully: ${outputLcov}`);

    // Extract merged coverage statistics
    this.summary.mergedCoverage = this.extractCoverageStats(outputLcov);

    return outputLcov;
  }

  /**
   * Merge multiple LCOV files
   */
  async mergeMultipleLcovFiles(filePaths, outputPath) {
    console.log(`🔧 Merging ${filePaths.length} LCOV files...`);

    try {
      // Try lcov-result-merger first
      const quotedPaths = filePaths.map(p => `"${p}"`).join(' ');
      const command = `npx lcov-result-merger ${quotedPaths} "${outputPath}"`;

      console.log(`Executing: ${command}`);
      execSync(command, { stdio: 'pipe' });
      console.log('✅ Used lcov-result-merger');
    } catch (error) {
      console.log('⚠️  lcov-result-merger failed, using Python fallback');

      // Use Python merger as fallback
      const pythonMerger = path.join(__dirname, 'merge-coverage.py');
      if (fs.existsSync(pythonMerger)) {
        const command = `python3 "${pythonMerger}" ${filePaths.map(p => `"${p}"`).join(' ')} -o "${outputPath}"`;
        console.log(`Executing: ${command}`);
        execSync(command, { stdio: 'inherit' });
        console.log('✅ Used Python fallback merger');
      } else {
        throw new Error('No coverage merger available');
      }
    }
  }

  /**
   * Check if LCOV file is valid
   */
  isValidLcovFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return content.includes('SF:') && content.includes('DA:') && content.trim().length > 50;
    } catch {
      return false;
    }
  }

  /**
   * Extract coverage statistics from LCOV file
   */
  extractCoverageStats(lcovPath) {
    const content = fs.readFileSync(lcovPath, 'utf8');
    const lines = content.split('\n');

    const stats = {
      files: 0,
      lines: { total: 0, covered: 0, pct: 0 },
      functions: { total: 0, covered: 0, pct: 0 },
      branches: { total: 0, covered: 0, pct: 0 },
      statements: { total: 0, covered: 0, pct: 0 },
    };

    // Count files
    stats.files = (content.match(/^SF:/gm) || []).length;

    // Sum totals
    for (const line of lines) {
      if (line.startsWith('LF:')) {
        stats.lines.total += parseInt(line.substring(3)) || 0;
      } else if (line.startsWith('LH:')) {
        stats.lines.covered += parseInt(line.substring(3)) || 0;
      } else if (line.startsWith('FNF:')) {
        stats.functions.total += parseInt(line.substring(4)) || 0;
      } else if (line.startsWith('FNH:')) {
        stats.functions.covered += parseInt(line.substring(4)) || 0;
      } else if (line.startsWith('BRF:')) {
        stats.branches.total += parseInt(line.substring(4)) || 0;
      } else if (line.startsWith('BRH:')) {
        stats.branches.covered += parseInt(line.substring(4)) || 0;
      }
    }

    // Calculate percentages
    stats.lines.pct = stats.lines.total > 0 ? (stats.lines.covered / stats.lines.total) * 100 : 0;
    stats.functions.pct = stats.functions.total > 0 ? (stats.functions.covered / stats.functions.total) * 100 : 0;
    stats.branches.pct = stats.branches.total > 0 ? (stats.branches.covered / stats.branches.total) * 100 : 0;

    // Statements = lines for most tools
    stats.statements = { ...stats.lines };

    return stats;
  }

  /**
   * Generate comprehensive coverage summary
   */
  async generateComprehensiveSummary() {
    console.log('📊 Generating comprehensive coverage summary...');

    const summaryPath = path.join(this.outputDir, 'coverage-summary.json');
    const metricsPath = path.join(this.outputDir, 'coverage-metrics.json');

    const summary = {
      total: this.summary.mergedCoverage,
      merged_from: this.summary.sources.map(s => s.path),
      timestamp: this.summary.timestamp,
      quality_score: this.calculateQualityScore(this.summary.mergedCoverage),
    };

    const metrics = {
      ...this.summary,
      coverageByType: this.summary.coverageByType,
      mergedCoverage: this.summary.mergedCoverage,
      qualityScore: summary.quality_score,
      tests: {
        total: 0, // Will be populated by test summary generator
        passed: 0,
        failed: 0,
        suites: Object.keys(this.summary.coverageByType).length,
      },
    };

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));

    console.log(`✅ Generated ${summaryPath}`);
    console.log(`✅ Generated ${metricsPath}`);

    // Log summary
    const cov = this.summary.mergedCoverage;
    console.log(
      `📈 Final Coverage: ${cov.lines.pct.toFixed(2)}% lines, ${cov.functions.pct.toFixed(2)}% functions, ${cov.branches.pct.toFixed(2)}% branches`
    );
    console.log(`🏆 Quality Score: ${summary.quality_score.toFixed(1)}/100`);
  }

  /**
   * Calculate quality score
   */
  calculateQualityScore(coverage) {
    if (!coverage) {
      return 0;
    }
    return coverage.lines.pct * 0.4 + coverage.functions.pct * 0.3 + coverage.branches.pct * 0.3;
  }

  /**
   * Generate professional test summary
   */
  async generateTestSummary() {
    console.log('📝 Generating test summary...');

    try {
      const summaryGenerator = path.join(__dirname, 'generate-test-summary.js');

      if (fs.existsSync(summaryGenerator)) {
        execSync(`node "${summaryGenerator}" --test-results test-results --output reports`, {
          stdio: 'inherit',
          cwd: this.workingDir,
        });
        console.log('✅ Test summary generated successfully');
      } else {
        console.log('⚠️  Test summary generator not found, skipping');
      }
    } catch (error) {
      console.log(`⚠️  Test summary generation failed: ${error.message}`);
      // Don't fail the whole process for this
    }
  }

  /**
   * Create empty coverage for cases where no coverage is found
   */
  createEmptyCoverage() {
    console.log('📄 Creating empty coverage placeholders...');

    fs.mkdirSync(this.mergedDir, { recursive: true });
    fs.mkdirSync('reports', { recursive: true });

    // Empty LCOV file
    fs.writeFileSync(path.join(this.mergedDir, 'lcov.info'), '');

    // Empty coverage summary
    const emptySummary = {
      total: {
        lines: { total: 0, covered: 0, pct: 0 },
        statements: { total: 0, covered: 0, pct: 0 },
        functions: { total: 0, covered: 0, pct: 0 },
        branches: { total: 0, covered: 0, pct: 0 },
      },
      merged_from: [],
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(this.outputDir, 'coverage-summary.json'), JSON.stringify(emptySummary, null, 2));

    // Basic test summary
    const basicSummary = `# Test Summary Report

**No coverage data available**

No valid coverage files were found. This may indicate:
- Tests did not run successfully
- Coverage collection was not configured
- Coverage files were not preserved in CI artifacts

Please check the individual test job logs for more information.
`;

    fs.writeFileSync('reports/test-summary.md', basicSummary);
  }

  /**
   * Set GitHub Actions output variables
   */
  setGitHubOutputs() {
    if (!process.env.GITHUB_OUTPUT) {
      return;
    }

    const outputs = [];

    if (this.summary.mergedCoverage) {
      outputs.push(`coverage_pct=${this.summary.mergedCoverage.lines.pct.toFixed(2)}`);
      outputs.push(`status=available`);
      outputs.push(`quality_score=${this.calculateQualityScore(this.summary.mergedCoverage).toFixed(1)}`);

      // Quality gates
      const linesPct = this.summary.mergedCoverage.lines.pct;
      if (linesPct >= 25) {
        outputs.push(`coverage_status=good`);
      } else if (linesPct >= 15) {
        outputs.push(`coverage_status=warning`);
      } else {
        outputs.push(`coverage_status=critical`);
      }
    } else {
      outputs.push(`coverage_pct=0`);
      outputs.push(`status=missing`);
      outputs.push(`coverage_status=missing`);
    }

    // Write to GitHub outputs
    const outputFile = process.env.GITHUB_OUTPUT;
    fs.appendFileSync(outputFile, `${outputs.join('\n')}\n`);

    console.log('📤 GitHub outputs set:', outputs.join(', '));
  }
}

/**
 * Main execution
 */
async function main() {
  const merger = new CICoverageMerger();
  await merger.run();
}

// Export for testing
export { CICoverageMerger };

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
