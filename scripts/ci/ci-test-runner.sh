#!/bin/bash

# CI Test Runner - Optimized for GitHub Actions
# Reduces runtime by running only essential tests with optimized settings

set -e

TEST_TYPE="${1:-unit}"
NODE_VERSION="${2:-20}"
SHARD="${3:-1}"
TOTAL_SHARDS="${4:-2}"

echo "Running $TEST_TYPE tests (Node $NODE_VERSION, shard $SHARD/$TOTAL_SHARDS)"

# Set memory limits based on test type
case "$TEST_TYPE" in
  unit)
    NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=4096"
    MAX_WORKERS=4
    TIMEOUT=30000
    ;;
  integration)
    NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=4096"
    MAX_WORKERS=2
    TIMEOUT=45000
    ;;
  e2e)
    NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=4096"
    MAX_WORKERS=2
    TIMEOUT=60000
    ;;
  performance)
    NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=6144"
    MAX_WORKERS=2
    TIMEOUT=120000
    ;;
  security)
    NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=4096"
    MAX_WORKERS=4
    TIMEOUT=45000
    ;;
  *)
    echo "Invalid test type: $TEST_TYPE"
    exit 1
    ;;
esac

export NODE_OPTIONS

# Create coverage directory
mkdir -p coverage/$TEST_TYPE

# Run tests with optimized settings
case "$TEST_TYPE" in
  unit)
    npm run test:unit -- \
      --shard=$SHARD/$TOTAL_SHARDS \
      --coverage \
      --coverageDirectory=coverage/unit \
      --coverageReporters=lcov \
      --maxWorkers=$MAX_WORKERS \
      --testTimeout=$TIMEOUT \
      --forceExit \
      --detectOpenHandles \
      --passWithNoTests
    ;;
  integration)
    npm run test:integration \
      --testTimeout=$TIMEOUT \
      --forceExit \
      --detectOpenHandles \
      --passWithNoTests
    ;;
  e2e)
    npm run test:e2e -- \
      --maxWorkers=$MAX_WORKERS \
      --testTimeout=$TIMEOUT \
      --forceExit \
      --detectOpenHandles \
      --passWithNoTests
    ;;
  performance)
    npm run test:performance -- \
      --coverage \
      --coverageDirectory=coverage/performance \
      --coverageReporters=lcov \
      --maxWorkers=$MAX_WORKERS \
      --testTimeout=$TIMEOUT \
      --forceExit \
      --detectOpenHandles \
      --passWithNoTests
    ;;
  security)
    npm run test:security -- \
      --maxWorkers=$MAX_WORKERS \
      --testTimeout=$TIMEOUT \
      --forceExit \
      --detectOpenHandles \
      --passWithNoTests
    ;;
esac

echo "✅ $TEST_TYPE tests completed successfully"