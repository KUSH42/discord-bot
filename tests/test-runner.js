#!/usr/bin/env node

/**
 * Enhanced test runner with additional utilities
 * Provides simplified commands for common testing scenarios
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { timestampUTC } from '../src/utilities/utc-time.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const NODE_OPTIONS = '--experimental-vm-modules';

// Color utilities
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function log(message, color = 'reset') {
  console.log(colorize(message, color));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: projectRoot,
      env: { ...process.env, NODE_OPTIONS },
      ...options,
    });

    child.on('close', code => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

async function runTests(testType, extraArgs = []) {
  const commands = {
    unit: ['npx', 'jest', 'tests/unit', ...extraArgs],
    integration: ['npx', 'jest', 'tests/integration', ...extraArgs],
    e2e: ['npx', 'jest', '--config', 'jest.e2e.config.js', ...extraArgs],
    security: ['npx', 'jest', '--config', 'jest.security.config.js', ...extraArgs],
    performance: ['npx', 'jest', 'tests/performance', ...extraArgs],
    all: ['npx', 'jest', ...extraArgs],
    coverage: ['npx', 'jest', '--coverage', ...extraArgs],
    watch: ['npx', 'jest', '--watch', ...extraArgs],
    debug: ['npx', 'jest', '--runInBand', '--no-cache', ...extraArgs],
    dev: ['npx', 'jest', '--config', 'jest.dev.config.js', ...extraArgs],
  };

  const command = commands[testType];
  if (!command) {
    throw new Error(`Unknown test type: ${testType}`);
  }

  const [cmd, ...args] = command;
  await runCommand(cmd, args);
}

function printUsage() {
  log('\\n🧪 Enhanced Test Runner', 'cyan');
  log('=====================================', 'cyan');
  log('');
  log('Usage: node tests/test-runner.js <command> [options]', 'bright');
  log('');
  log('Commands:', 'yellow');
  log('  unit         Run unit tests only');
  log('  integration  Run integration tests only');
  log('  e2e          Run end-to-end tests');
  log('  security     Run security tests');
  log('  performance  Run performance tests');
  log('  all          Run all tests');
  log('  coverage     Run tests with coverage report');
  log('  watch        Run tests in watch mode');
  log('  debug        Run tests in debug mode');
  log('  dev          Run tests with dev-optimized config');
  log('');
  log('Examples:', 'green');
  log('  node tests/test-runner.js unit');
  log('  node tests/test-runner.js watch command-processor');
  log('  node tests/test-runner.js coverage --verbose');
  log('  node tests/test-runner.js dev --bail');
  log('');
  log('Additional Jest options can be passed after the command.', 'magenta');
}

function showTestStats() {
  log('\\n📊 Test Suite Overview', 'cyan');
  log('=====================================', 'cyan');
  log('Test Types:');
  log('  • Unit Tests: Individual component testing');
  log('  • Integration: Component interaction testing');
  log('  • E2E: End-to-end workflow testing');
  log('  • Security: Security validation testing');
  log('  • Performance: Performance benchmark testing');
  log('');
  log('Quick Commands:', 'yellow');
  log('  npm test              - Run all tests');
  log('  npm run test:coverage - Generate coverage report');
  log('  npm run test:watch    - Watch mode');
  log('  npm run test:parallel - Parallel execution');
  log('');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return;
  }

  if (args[0] === '--stats') {
    showTestStats();
    return;
  }

  const testType = args[0];
  const extraArgs = args.slice(1);

  try {
    log(`\\n🚀 Running ${testType} tests...`, 'green');
    log(`Arguments: ${extraArgs.join(' ')}`, 'magenta');
    log('', 'reset');

    const startTime = timestampUTC();
    await runTests(testType, extraArgs);
    const duration = ((timestampUTC() - startTime) / 1000).toFixed(2);

    log(`\\n✅ Tests completed successfully in ${duration}s`, 'green');
  } catch (error) {
    log(`\\n❌ Tests failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', error => {
  log(`\\n💥 Uncaught Exception: ${error.message}`, 'red');
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  log(`\\n💥 Unhandled Rejection: ${reason}`, 'red');
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runTests, printUsage, showTestStats };
