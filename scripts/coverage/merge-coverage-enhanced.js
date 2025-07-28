#!/usr/bin/env node

/**
 * Enhanced Coverage Merger
 *
 * A comprehensive solution for merging LCOV coverage files from multiple test suites
 * while avoiding double-counting and providing detailed reporting.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CoverageMerger {
  constructor() {
    this.coverageFiles = [];
    this.mergedData = {};
    this.summary = {
      timestamp: new Date().toISOString(),
      sources: [],
      totals: {
        files: 0,
        lines: { total: 0, covered: 0, pct: 0 },
        functions: { total: 0, covered: 0, pct: 0 },
        branches: { total: 0, covered: 0, pct: 0 },
        statements: { total: 0, covered: 0, pct: 0 },
      },
    };
  }

  /**
   * Find all LCOV files in specified directories
   */
  findCoverageFiles(searchPaths) {
    const patterns = ['coverage/**/lcov.info', 'test-results/**/lcov.info', '**/coverage/**/lcov.info'];

    console.log('🔍 Searching for coverage files...');

    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) {
        console.log(`⚠️  Search path not found: ${searchPath}`);
        continue;
      }

      console.log(`📂 Scanning: ${searchPath}`);

      try {
        const files = this.findFilesRecursively(searchPath, 'lcov.info');
        for (const file of files) {
          // Skip files in the output directory to prevent circular merging
          if (file.includes('/merged/') && file.includes('lcov.info')) {
            console.log(`⏭️  Skipping merged file: ${file}`);
            continue;
          }

          if (this.isValidLcovFile(file)) {
            this.coverageFiles.push(file);
            console.log(`✅ Found: ${file}`);
          }
        }
      } catch (error) {
        console.log(`❌ Error scanning ${searchPath}: ${error.message}`);
      }
    }

    console.log(`📊 Total coverage files found: ${this.coverageFiles.length}`);
    return this.coverageFiles;
  }

  /**
   * Recursively find files with specified name
   */
  findFilesRecursively(dir, filename) {
    const results = [];

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and other irrelevant directories
        if (!['node_modules', '.git', '.github'].includes(item)) {
          results.push(...this.findFilesRecursively(fullPath, filename));
        }
      } else if (item === filename) {
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * Validate LCOV file has actual coverage data
   */
  isValidLcovFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Check if file has actual coverage data (not just headers)
      return content.includes('SF:') && content.includes('DA:') && content.trim().length > 50;
    } catch (error) {
      console.log(`❌ Error reading ${filePath}: ${error.message}`);
      return false;
    }
  }

  /**
   * Merge coverage files using lcov-result-merger
   */
  async mergeCoverageFiles(outputPath) {
    if (this.coverageFiles.length === 0) {
      throw new Error('No valid coverage files found to merge');
    }

    console.log('🔄 Merging coverage files...');

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    // Create temporary directory for processing
    const tempDir = path.join(outputDir, 'temp');
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Copy and deduplicate coverage files
      const uniqueFiles = await this.deduplicateCoverageFiles(tempDir);

      if (uniqueFiles.length === 1) {
        // If only one file, just copy it
        fs.copyFileSync(uniqueFiles[0], outputPath);
        console.log(`📄 Single coverage file copied to ${outputPath}`);
      } else {
        // Use lcov-result-merger for proper merging
        await this.mergeLcovFiles(uniqueFiles, outputPath);
      }

      // Generate summary statistics
      await this.generateSummary(outputPath);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });

      console.log(`✅ Coverage merged successfully: ${outputPath}`);
      return this.summary;
    } catch (error) {
      // Cleanup on error
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Deduplicate coverage files by content and source type
   */
  async deduplicateCoverageFiles(tempDir) {
    const uniqueFiles = [];
    const seenHashes = new Set();

    console.log('🧹 Deduplicating coverage files...');

    for (let i = 0; i < this.coverageFiles.length; i++) {
      const file = this.coverageFiles[i];
      const content = fs.readFileSync(file, 'utf8');

      // Create content hash for deduplication
      const hash = createHash('md5').update(content).digest('hex');

      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        const uniqueFile = path.join(tempDir, `lcov-${i}.info`);
        fs.writeFileSync(uniqueFile, content);
        uniqueFiles.push(uniqueFile);

        // Identify source type from path
        let sourceType = 'unknown';
        if (file.includes('unit')) {
          sourceType = 'unit';
        } else if (file.includes('integration')) {
          sourceType = 'integration';
        } else if (file.includes('e2e')) {
          sourceType = 'e2e';
        } else if (file.includes('performance')) {
          sourceType = 'performance';
        }

        this.summary.sources.push({
          original: file,
          type: sourceType,
          size: content.length,
          hash: hash.substring(0, 8),
        });

        console.log(`📝 Unique file ${i}: ${sourceType} (${content.length} bytes)`);
      } else {
        console.log(`🔄 Duplicate content found, skipping: ${file}`);
      }
    }

    console.log(`📊 Unique files after deduplication: ${uniqueFiles.length}`);
    return uniqueFiles;
  }

  /**
   * Merge LCOV files using appropriate tool
   */
  async mergeLcovFiles(files, outputPath) {
    console.log('🔧 Merging LCOV files...');

    // Use our proven Python merger directly since lcov-result-merger has issues
    const pythonMerger = path.join(__dirname, 'merge-coverage.py');
    const command = `python3 "${pythonMerger}" ${files.map(f => `"${f}"`).join(' ')} -o "${outputPath}"`;
    console.log(`Executing: ${command}`);

    try {
      execSync(command, { stdio: 'inherit' });

      // Verify the output file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Output file was not created');
      }
      console.log('✅ Used Python merger for merging');
    } catch (error) {
      console.log(`❌ Python merger failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate comprehensive coverage summary
   */
  async generateSummary(lcovPath) {
    console.log('📊 Generating coverage summary...');

    try {
      const content = fs.readFileSync(lcovPath, 'utf8');

      // Extract metrics using regex patterns
      const metrics = this.extractMetricsFromLcov(content);

      this.summary.totals = metrics;
      this.summary.totals.files = (content.match(/^SF:/gm) || []).length;

      // Calculate quality score
      const qualityScore = this.calculateQualityScore(metrics);
      this.summary.qualityScore = qualityScore;

      console.log(`📈 Coverage Summary:`);
      console.log(`   Files: ${this.summary.totals.files}`);
      console.log(`   Lines: ${metrics.lines.covered}/${metrics.lines.total} (${metrics.lines.pct.toFixed(2)}%)`);
      console.log(
        `   Functions: ${metrics.functions.covered}/${metrics.functions.total} (${metrics.functions.pct.toFixed(2)}%)`
      );
      console.log(
        `   Branches: ${metrics.branches.covered}/${metrics.branches.total} (${metrics.branches.pct.toFixed(2)}%)`
      );
      console.log(`   Quality Score: ${qualityScore.toFixed(1)}/100`);
    } catch (error) {
      console.log(`❌ Error generating summary: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract coverage metrics from LCOV content
   */
  extractMetricsFromLcov(content) {
    const lines = content.split('\n');

    const totals = {
      lines: { total: 0, covered: 0, pct: 0 },
      functions: { total: 0, covered: 0, pct: 0 },
      branches: { total: 0, covered: 0, pct: 0 },
      statements: { total: 0, covered: 0, pct: 0 },
    };

    // Sum up all LF/LH (lines found/hit), FNF/FNH (functions), BRF/BRH (branches)
    for (const line of lines) {
      if (line.startsWith('LF:')) {
        totals.lines.total += parseInt(line.substring(3)) || 0;
      } else if (line.startsWith('LH:')) {
        totals.lines.covered += parseInt(line.substring(3)) || 0;
      } else if (line.startsWith('FNF:')) {
        totals.functions.total += parseInt(line.substring(4)) || 0;
      } else if (line.startsWith('FNH:')) {
        totals.functions.covered += parseInt(line.substring(4)) || 0;
      } else if (line.startsWith('BRF:')) {
        totals.branches.total += parseInt(line.substring(4)) || 0;
      } else if (line.startsWith('BRH:')) {
        totals.branches.covered += parseInt(line.substring(4)) || 0;
      }
    }

    // Calculate percentages
    totals.lines.pct = totals.lines.total > 0 ? (totals.lines.covered / totals.lines.total) * 100 : 0;
    totals.functions.pct = totals.functions.total > 0 ? (totals.functions.covered / totals.functions.total) * 100 : 0;
    totals.branches.pct = totals.branches.total > 0 ? (totals.branches.covered / totals.branches.total) * 100 : 0;

    // Statements same as lines for most tools
    totals.statements = { ...totals.lines };

    return totals;
  }

  /**
   * Calculate overall quality score
   */
  calculateQualityScore(metrics) {
    // Weighted score: lines 40%, functions 30%, branches 30%
    return metrics.lines.pct * 0.4 + metrics.functions.pct * 0.3 + metrics.branches.pct * 0.3;
  }

  /**
   * Generate JSON summary file
   */
  generateJsonSummary(outputDir) {
    const summaryPath = path.join(outputDir, 'coverage-summary.json');
    const metricsPath = path.join(outputDir, 'coverage-metrics.json');

    // Standard coverage-summary.json format
    const coverageSummary = {
      total: this.summary.totals,
      merged_from: this.summary.sources.map(s => s.original),
      timestamp: this.summary.timestamp,
      quality_score: this.summary.qualityScore,
    };

    // Extended metrics file
    const coverageMetrics = {
      ...this.summary,
      tests: this.extractTestMetrics(),
    };

    fs.writeFileSync(summaryPath, JSON.stringify(coverageSummary, null, 2));
    fs.writeFileSync(metricsPath, JSON.stringify(coverageMetrics, null, 2));

    console.log(`✅ Generated ${summaryPath}`);
    console.log(`✅ Generated ${metricsPath}`);

    return { summaryPath, metricsPath };
  }

  /**
   * Extract test metrics from available data
   */
  extractTestMetrics() {
    // This would be populated by test runners
    return {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      suites: this.summary.sources.length,
    };
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Enhanced Coverage Merger

Usage:
  node merge-coverage-enhanced.js [options]

Options:
  --search-paths <paths>     Comma-separated search paths (default: .,test-results,coverage)
  --output <path>            Output merged LCOV file (default: coverage/merged/lcov.info)
  --json-output <dir>        Directory for JSON summary files (default: same as LCOV output)
  --help                     Show this help

Examples:
  node merge-coverage-enhanced.js
  node merge-coverage-enhanced.js --search-paths "test-results,coverage"
  node merge-coverage-enhanced.js --output ./merged-coverage/lcov.info
`);
    process.exit(0);
  }

  // Parse arguments
  const searchPathsArg =
    args.find(arg => arg.startsWith('--search-paths='))?.split('=')[1] ||
    (args.includes('--search-paths') ? args[args.indexOf('--search-paths') + 1] : null);
  const outputArg =
    args.find(arg => arg.startsWith('--output='))?.split('=')[1] ||
    (args.includes('--output') ? args[args.indexOf('--output') + 1] : null);
  const jsonOutputArg =
    args.find(arg => arg.startsWith('--json-output='))?.split('=')[1] ||
    (args.includes('--json-output') ? args[args.indexOf('--json-output') + 1] : null);

  const searchPaths = searchPathsArg ? searchPathsArg.split(',') : ['.', 'test-results', 'coverage'];
  const outputPath = outputArg || 'coverage/merged/lcov.info';
  const jsonOutputDir = jsonOutputArg || path.dirname(outputPath);

  console.log('🚀 Enhanced Coverage Merger Starting...');
  console.log(`📂 Search paths: ${searchPaths.join(', ')}`);
  console.log(`📄 Output LCOV: ${outputPath}`);
  console.log(`📊 JSON output: ${jsonOutputDir}`);

  try {
    const merger = new CoverageMerger();

    // Find coverage files
    const files = merger.findCoverageFiles(searchPaths);

    if (files.length === 0) {
      console.log('❌ No coverage files found. Make sure tests have been run and generated coverage.');
      process.exit(1);
    }

    // Merge coverage
    const summary = await merger.mergeCoverageFiles(outputPath);

    // Generate JSON files
    const { summaryPath, metricsPath } = merger.generateJsonSummary(jsonOutputDir);

    console.log('\n✅ Coverage merging completed successfully!');
    console.log(`📊 Final Coverage: ${summary.totals.lines.pct.toFixed(2)}%`);
    console.log(`🏆 Quality Score: ${summary.qualityScore.toFixed(1)}/100`);

    // Exit with status based on coverage quality
    if (summary.totals.lines.pct >= 25) {
      console.log('🎯 Coverage meets minimum standards');
      process.exit(0);
    } else if (summary.totals.lines.pct >= 15) {
      console.log('⚠️  Coverage below target but acceptable');
      process.exit(0);
    } else {
      console.log('❌ Coverage critically low');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Coverage merging failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Export for testing
export { CoverageMerger };

// Run CLI if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
