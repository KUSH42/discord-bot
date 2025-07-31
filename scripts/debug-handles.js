#!/usr/bin/env node

/**
 * CLI tool for debugging open handles in the Discord bot
 *
 * Usage:
 *   node scripts/debug-handles.js
 *   node scripts/debug-handles.js --monitor
 *   node scripts/debug-handles.js --force-close
 */

import detector from '../tests/utils/open-handle-detector.js';

const args = process.argv.slice(2);
const isMonitoring = args.includes('--monitor');
const forceClose = args.includes('--force-close');

console.log('🔍 Discord Bot Handle Debugger\n');

if (forceClose) {
  console.log('🔧 Force closing open handles...');
  const closed = detector.forceCloseHandles();
  console.log(`✅ Closed ${closed} handles`);
  process.exit(0);
}

function checkHandles() {
  const analysis = detector.getOpenHandles();

  console.clear();
  console.log('🔍 Discord Bot Handle Debugger');
  console.log('='.repeat(50));
  console.log(`Time: ${new Date().toLocaleTimeString()}`);
  console.log(`Total Handles: ${analysis.summary.totalHandles}`);
  console.log(`Total Requests: ${analysis.summary.totalRequests}`);
  console.log('='.repeat(50));

  if (analysis.handles.length > 0) {
    console.log('\n📋 ACTIVE HANDLES:');
    const handleCounts = {};
    analysis.handles.forEach(handle => {
      handleCounts[handle.type] = (handleCounts[handle.type] || 0) + 1;
    });

    Object.entries(handleCounts).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

    // Show details for problematic handles
    const problematicTypes = ['Timeout', 'Socket', 'Server', 'ChildProcess'];
    analysis.handles.forEach(handle => {
      if (problematicTypes.includes(handle.type) && handle.details) {
        console.log(`\n  🔍 ${handle.type} #${handle.index}:`);
        Object.entries(handle.details).forEach(([key, value]) => {
          console.log(`    ${key}: ${value}`);
        });
      }
    });
  }

  if (analysis.requests.length > 0) {
    console.log('\n🌐 ACTIVE REQUESTS:');
    analysis.requests.forEach(request => {
      console.log(`  ${request.type}: ${JSON.stringify(request.details)}`);
    });
  }

  if (analysis.summary.totalHandles === 0 && analysis.summary.totalRequests === 0) {
    console.log('\n✅ No open handles detected!');
  }

  console.log('\n💡 Commands:');
  console.log('  Ctrl+C: Exit');
  console.log('  node scripts/debug-handles.js --force-close: Force close handles');
}

if (isMonitoring) {
  console.log('📊 Monitoring mode - Updates every 2 seconds (Ctrl+C to exit)\n');

  checkHandles();
  const interval = setInterval(checkHandles, 2000);

  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n👋 Monitoring stopped');
    process.exit(0);
  });
} else {
  // Single check
  checkHandles();

  console.log('\n🚀 Run with --monitor flag for continuous monitoring');
  console.log('🔧 Run with --force-close flag to force close all handles');
}
