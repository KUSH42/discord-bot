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

    // Dynamically discover all possible coverage file locations
    const searchPaths = [
      // PRIORITY: Fresh main coverage file (from local test runs)
      './lcov.info',
      'lcov.info',

      // Current standard paths
      'test-results/unit/node18/coverage/unit/lcov.info',
      'test-results/unit/node20/coverage/unit/lcov.info',
      'test-results/integration/coverage/integration/lcov.info',
      'test-results/e2e/coverage/e2e/lcov.info',
      'test-results/performance/coverage/performance/lcov.info',

      // Alternative artifact naming patterns
      'test-results/unit-test-results-node18/coverage/unit/lcov.info',
      'test-results/unit-test-results-node20/coverage/unit/lcov.info',
      'test-results/integration-test-results/coverage/integration/lcov.info',
      'test-results/e2e-test-results/coverage/e2e/lcov.info',
      'test-results/performance-test-results/coverage/performance/lcov.info',

      // Direct coverage directory paths
      'coverage/unit/lcov.info',
      'coverage/integration/lcov.info',
      'coverage/e2e/lcov.info',
      'coverage/performance/lcov.info',
      'coverage/lcov.info',

      // GitHub Actions artifact patterns
      'unit-test-results-node18/coverage/unit/lcov.info',
      'unit-test-results-node20/coverage/unit/lcov.info',
      'integration-test-results/coverage/integration/lcov.info',
      'e2e-test-results/coverage/e2e/lcov.info',
      'performance-test-results/coverage/performance/lcov.info',
    ];

    // Also dynamically search for any lcov.info files in test-results
    const dynamicPaths = this.discoverDynamicCoveragePaths();
    searchPaths.push(...dynamicPaths);

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
   * Dynamically discover coverage paths by scanning directories
   */
  discoverDynamicCoveragePaths() {
    const dynamicPaths = [];

    try {
      // Scan test-results directory if it exists
      if (fs.existsSync('test-results')) {
        this.scanDirectoryForLcov('test-results', dynamicPaths);
      }

      // Scan current directory for artifact directories
      const entries = fs.readdirSync('.', { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          (entry.name.includes('test-results') ||
            entry.name.includes('coverage') ||
            entry.name.endsWith('-test-results'))
        ) {
          this.scanDirectoryForLcov(entry.name, dynamicPaths);
        }
      }
    } catch (error) {
      console.log(`⚠️  Dynamic discovery error: ${error.message}`);
    }

    if (dynamicPaths.length > 0) {
      console.log(`🔍 Dynamically discovered ${dynamicPaths.length} additional coverage paths`);
    }

    return dynamicPaths;
  }

  /**
   * Recursively scan directory for lcov.info files
   */
  scanDirectoryForLcov(dirPath, foundPaths, maxDepth = 4) {
    if (maxDepth <= 0) {
      return;
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isFile() && entry.name === 'lcov.info') {
          foundPaths.push(fullPath);
        } else if (entry.isDirectory() && maxDepth > 1) {
          this.scanDirectoryForLcov(fullPath, foundPaths, maxDepth - 1);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
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
      const result = execSync(command, { stdio: 'pipe', encoding: 'utf8' });
      console.log('✅ Used lcov-result-merger');

      // Check if the merge actually worked
      if (fs.existsSync(outputPath)) {
        const content = fs.readFileSync(outputPath, 'utf8');
        if (content.trim().length < 10) {
          console.log('⚠️  lcov-result-merger produced empty output, trying manual merge');
          this.manualMergeLcovFiles(filePaths, outputPath);
        } else {
          console.log(`✅ lcov-result-merger succeeded: ${content.length} characters`);
        }
      } else {
        console.log('⚠️  lcov-result-merger did not create output file, trying manual merge');
        this.manualMergeLcovFiles(filePaths, outputPath);
      }
    } catch (error) {
      console.log(`⚠️  lcov-result-merger failed: ${error.message}`);
      console.log('Using manual merge fallback...');
      this.manualMergeLcovFiles(filePaths, outputPath);
    }
  }

  /**
   * Manual LCOV file merging as fallback
   */
  manualMergeLcovFiles(filePaths, outputPath) {
    console.log('🔧 Performing manual LCOV merge...');

    let mergedContent = '';
    const seenFiles = new Set();

    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        let currentFile = '';
        let fileData = [];

        for (const line of lines) {
          if (line.startsWith('SF:')) {
            // New source file
            if (currentFile && !seenFiles.has(currentFile)) {
              mergedContent += `${fileData.join('\n')}\n`;
              seenFiles.add(currentFile);
            }
            currentFile = line.substring(3);
            fileData = [line];
          } else if (line.trim()) {
            fileData.push(line);
          }
        }

        // Add the last file
        if (currentFile && !seenFiles.has(currentFile)) {
          mergedContent += `${fileData.join('\n')}\n`;
          seenFiles.add(currentFile);
        }
      } catch (error) {
        console.log(`⚠️  Failed to read ${filePath}: ${error.message}`);
      }
    }

    fs.writeFileSync(outputPath, mergedContent);
    console.log(`✅ Manual merge completed, ${seenFiles.size} unique files`);
  }

  /**
   * Check if LCOV file is valid
   */
  isValidLcovFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const trimmed = content.trim();

      // A valid LCOV file should have:
      // 1. Some actual content (more than just a newline)
      // 2. At least one SF: line (source file)
      // 3. Some meaningful size
      const hasContent = trimmed.length > 10;
      const hasSourceFiles = content.includes('SF:');

      console.log(`📋 Validating ${filePath}: length=${trimmed.length}, hasSourceFiles=${hasSourceFiles}`);

      return hasContent && hasSourceFiles;
    } catch (error) {
      console.log(`❌ Failed to validate ${filePath}: ${error.message}`);
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
   * Generate comprehensive coverage summary and HTML report
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

    // Generate HTML coverage report
    await this.generateHtmlReport();

    // Log summary
    const cov = this.summary.mergedCoverage;
    console.log(
      `📈 Final Coverage: ${cov.lines.pct.toFixed(2)}% lines, ${cov.functions.pct.toFixed(2)}% functions, ${cov.branches.pct.toFixed(2)}% branches`
    );
    console.log(`🏆 Quality Score: ${summary.quality_score.toFixed(1)}/100`);
  }

  /**
   * Generate HTML coverage report using genhtml
   */
  async generateHtmlReport() {
    console.log('🌐 Generating HTML coverage report...');

    const lcovFile = path.join(this.mergedDir, 'lcov.info');
    const htmlDir = path.join(this.outputDir, 'html');

    if (!fs.existsSync(lcovFile)) {
      console.log('⚠️  No LCOV file found, skipping HTML report');
      return;
    }

    try {
      // Create HTML output directory
      fs.mkdirSync(htmlDir, { recursive: true });

      // Copy custom CSS if available
      const cssSourceDir = 'assets/lcov';
      if (fs.existsSync(cssSourceDir)) {
        console.log('📄 Copying custom CSS files...');
        const cssFiles = fs.readdirSync(cssSourceDir).filter(f => f.endsWith('.css'));
        for (const cssFile of cssFiles) {
          fs.copyFileSync(path.join(cssSourceDir, cssFile), path.join(htmlDir, cssFile));
        }
      }

      // Generate HTML report using genhtml
      const command = [
        'genhtml',
        `"${lcovFile}"`,
        `--output-directory "${htmlDir}"`,
        '--title "Discord Bot Coverage Report"',
        '--branch-coverage',
        '--function-coverage',
        `--prefix "${this.workingDir}"`,
        '--legend',
        '--show-details',
        '--dark-mode',
      ].join(' ');

      console.log(`Executing: ${command}`);
      execSync(command, { stdio: 'pipe' });

      console.log(`✅ HTML coverage report generated in ${htmlDir}`);

      // Create an index file for easy access
      const indexPath = path.join(this.outputDir, 'index.html');
      fs.writeFileSync(
        indexPath,
        `
<!DOCTYPE html>
<html>
<head>
    <title>Coverage Report</title>
    <meta http-equiv="refresh" content="0; url=html/index.html">
</head>
<body>
    <p>Redirecting to <a href="html/index.html">coverage report</a>...</p>
</body>
</html>
      `.trim()
      );
    } catch (error) {
      console.log(`⚠️  HTML report generation failed: ${error.message}`);
      console.log('Creating fallback HTML report...');

      // Create a simple fallback HTML report
      const fallbackHtml = this.createFallbackHtmlReport();
      fs.writeFileSync(path.join(htmlDir, 'index.html'), fallbackHtml);
    }
  }

  /**
   * Create a fallback HTML report when genhtml fails
   */
  createFallbackHtmlReport() {
    const cov = this.summary.mergedCoverage;
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Coverage Report - Fallback</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .metric { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .good { background: #d4edda; }
        .warning { background: #fff3cd; }
        .critical { background: #f8d7da; }
    </style>
</head>
<body>
    <h1>Coverage Report (Fallback)</h1>
    <p>Generated: ${this.summary.timestamp}</p>
    
    <div class="metric ${cov.lines.pct >= 70 ? 'good' : cov.lines.pct >= 40 ? 'warning' : 'critical'}">
        <strong>Lines:</strong> ${cov.lines.covered}/${cov.lines.total} (${cov.lines.pct.toFixed(2)}%)
    </div>
    
    <div class="metric ${cov.functions.pct >= 70 ? 'good' : cov.functions.pct >= 40 ? 'warning' : 'critical'}">
        <strong>Functions:</strong> ${cov.functions.covered}/${cov.functions.total} (${cov.functions.pct.toFixed(2)}%)
    </div>
    
    <div class="metric ${cov.branches.pct >= 70 ? 'good' : cov.branches.pct >= 40 ? 'warning' : 'critical'}">
        <strong>Branches:</strong> ${cov.branches.covered}/${cov.branches.total} (${cov.branches.pct.toFixed(2)}%)
    </div>
    
    <h2>Coverage by Type</h2>
    ${Object.entries(this.summary.coverageByType)
      .map(([type, files]) => `<div class="metric"><strong>${type}:</strong> ${files.length} file(s)</div>`)
      .join('')}
    
    <p><em>Full HTML report could not be generated. Check CI logs for details.</em></p>
</body>
</html>
    `.trim();
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
      const summaryGenerator = path.join(
        path.dirname(new URL(import.meta.url).pathname),
        '../testing/generate-test-summary.js'
      );

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
