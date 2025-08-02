/**
 * Custom Jest reporter for open handle debugging
 */

import detector from './open-handle-detector.js';

export default class HandleDebugReporter {
  constructor(globalConfig, reporterOptions) {
    this.globalConfig = globalConfig;
    this.reporterOptions = reporterOptions;
  }

  onRunStart() {
    console.log('\n🔍 Starting tests with handle debugging enabled...\n');
  }

  onTestStart(test) {
    if (this.reporterOptions?.verbose) {
      console.log(`🧪 Starting test: ${test.path}`);
    }
  }

  onTestResult(test, testResult) {
    if (testResult.numFailingTests > 0) {
      console.log(`\n❌ Test failed: ${test.path}`);
      if (global.__HANDLE_DEBUG__) {
        console.log('📊 Checking for open handles...');
        const analysis = detector.getOpenHandles();
        if (analysis.summary.newSinceStart.length > 0) {
          console.log('⚠️  Open handles found after failed test:');
          console.log(detector.generateReport());
        } else {
          console.log('✅ No new handles detected');
        }
      }
    }
  }

  onRunComplete() {
    console.log('\n🏁 Test run completed. Checking final handle state...');

    const finalAnalysis = detector.getOpenHandles();

    if (finalAnalysis.summary.totalHandles > 0 || finalAnalysis.summary.totalRequests > 0) {
      console.log('\n📊 Final Handle Report:');
      console.log(detector.generateReport());

      if (finalAnalysis.summary.newSinceStart.length > 0) {
        console.log('\n🚨 WARNING: Tests left open handles!');
        console.log('This may cause Jest to hang. Consider:');
        console.log('1. Adding proper cleanup in afterEach/afterAll');
        console.log('2. Using forceExit: true in Jest config');
        console.log('3. Checking for unclosed timers, sockets, or processes');
      } else {
        console.log('\n✅ No new handles created during tests');
      }
    } else {
      console.log('\n✅ All handles cleaned up successfully!');
    }
  }
}
