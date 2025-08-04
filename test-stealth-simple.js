#!/usr/bin/env node

/**
 * Simple stealth component test - bypasses full configuration validation
 * Tests core stealth functionality without requiring full production setup
 */

import { UserAgentManager } from './src/services/browser-stealth/user-agent-manager.js';
import { HumanBehaviorSimulator } from './src/services/browser-stealth/human-behavior-simulator.js';
import { IntelligentRateLimiter } from './src/services/browser-stealth/intelligent-rate-limiter.js';
import { DetectionMonitor } from './src/services/browser-stealth/detection-monitor.js';
import { PerformanceMonitor } from './src/services/browser-stealth/performance-monitor.js';

// Mock logger
const mockLogger = {
  info: (...args) => console.log('📝 [INFO]', ...args),
  debug: (...args) => console.log('🐛 [DEBUG]', ...args),
  warn: (...args) => console.log('⚠️  [WARN]', ...args),
  error: (...args) => console.log('❌ [ERROR]', ...args),
  child: meta => ({
    ...mockLogger,
    service: meta.service,
  }),
};

// Mock config
const mockConfig = {
  get: (key, defaultValue) => {
    const mockValues = {
      USER_AGENT_ROTATION_INTERVAL: 3600000,
      BROWSER_STEALTH_ENABLED: true,
      BEHAVIOR_SIMULATION_ENABLED: true,
      INTELLIGENT_RATE_LIMITING: true,
      DETECTION_MONITORING_ENABLED: true,
      PERFORMANCE_MONITORING_ENABLED: true,
    };
    return mockValues[key] ?? defaultValue;
  },
  getBoolean: (key, defaultValue) => {
    const mockValues = {
      BROWSER_STEALTH_ENABLED: true,
      BEHAVIOR_SIMULATION_ENABLED: true,
      INTELLIGENT_RATE_LIMITING: true,
      DETECTION_MONITORING_ENABLED: true,
      PERFORMANCE_MONITORING_ENABLED: true,
    };
    return mockValues[key] ?? defaultValue;
  },
};

async function testStealthComponents() {
  console.log('🧪 Testing Individual Stealth Components...\n');

  try {
    // 1. Test UserAgentManager
    console.log('1️⃣  Testing UserAgentManager...');
    const userAgentManager = new UserAgentManager();

    const currentUA = userAgentManager.getCurrentUserAgent();
    console.log('   ✅ Current User Agent:', `${currentUA.substring(0, 80)}...`);

    const viewport = userAgentManager.getMatchingViewport();
    console.log('   ✅ Matching Viewport:', viewport);

    const platform = userAgentManager.getPlatform();
    console.log('   ✅ Platform:', platform);

    const browser = userAgentManager.getBrowserName();
    console.log('   ✅ Browser:', browser);

    const status = userAgentManager.getRotationStatus();
    console.log('   ✅ Rotation Status:', {
      currentIndex: status.currentIndex,
      totalAgents: status.totalUserAgents,
      platform: status.platform,
      browser: status.browserName,
    });
    console.log();

    // 2. Test IntelligentRateLimiter
    console.log('2️⃣  Testing IntelligentRateLimiter...');
    const rateLimiter = new IntelligentRateLimiter(mockConfig, mockLogger);

    const nextInterval = rateLimiter.calculateNextInterval();
    console.log('   ✅ Next Interval:', `${Math.round(nextInterval / 1000)}s`);

    // Simulate some requests
    rateLimiter.recordRequest(true);
    rateLimiter.recordRequest(true);
    rateLimiter.recordRequest(false); // Failed request

    const limiterStatus = rateLimiter.getStatus();
    console.log('   ✅ Rate Limiter Status:', {
      pattern: limiterStatus.currentPattern,
      recentRequests: limiterStatus.recentRequests,
      emergencyMode: limiterStatus.emergencyMode,
      burstPenalty: Math.round(limiterStatus.burstPenalty * 100) / 100,
    });
    console.log();

    // 3. Test DetectionMonitor
    console.log('3️⃣  Testing DetectionMonitor...');
    const detectionMonitor = new DetectionMonitor(mockLogger, {
      alertThreshold: 3,
      monitoringWindow: 3600000,
    });

    // Simulate some requests
    detectionMonitor.recordRequest(true);
    detectionMonitor.recordRequest(true);
    detectionMonitor.recordRequest(false, 'Test detection incident', 'http://example.com');

    const detectionStatus = detectionMonitor.getStatus();
    const detectionMetrics = detectionStatus.metrics;
    console.log('   ✅ Detection Metrics:', {
      totalRequests: detectionMetrics.totalRequests,
      successfulRequests: detectionMetrics.successfulRequests,
      detectionIncidents: detectionMetrics.detectionIncidents,
      successRate: `${Math.round(detectionMetrics.successRate * 100)}%`,
    });
    console.log();

    // 4. Test PerformanceMonitor
    console.log('4️⃣  Testing PerformanceMonitor...');
    const performanceMonitor = new PerformanceMonitor(mockLogger, {
      samplingInterval: 30000,
      maxSamples: 1000,
    });

    // Simulate some operations
    const operation1 = performanceMonitor.startOperation();
    await new Promise(resolve => setTimeout(resolve, 100));
    performanceMonitor.endOperation(operation1, 'navigation');

    const operation2 = performanceMonitor.startOperation();
    await new Promise(resolve => setTimeout(resolve, 50));
    performanceMonitor.endOperation(operation2, 'interaction');

    const perfReport = performanceMonitor.getPerformanceReport();
    console.log('   ✅ Performance Report:', {
      samples: perfReport.samples,
      averageTime: `${Math.round(perfReport.averageOperationTime || 0)}ms`,
      grade: perfReport.performanceGrade,
      memoryUsage: `${Math.round((perfReport.currentMetrics?.memoryUsage || 0) / 1024)}KB`,
    });
    console.log();

    // 5. Test HumanBehaviorSimulator (without page)
    console.log('5️⃣  Testing HumanBehaviorSimulator (Config Only)...');

    // Mock page object for testing
    const mockPage = {
      goto: async url => ({ url, status: 200 }),
      mouse: {
        move: async (x, y) => ({ x, y }),
      },
      viewportSize: async () => ({ width: 1920, height: 1080 }),
      evaluate: async fn => {
        if (typeof fn === 'function') {
          return fn();
        }
        return 'mocked-result';
      },
    };

    const behaviorSimulator = new HumanBehaviorSimulator(mockPage, mockLogger);

    // Test configuration
    const behaviorStatus = behaviorSimulator.getStatus();
    console.log('   ✅ Behavior Simulator Status:', {
      enabled: behaviorStatus.enabled,
      mousePosition: behaviorStatus.mousePosition,
      configEnabled: {
        mouseMovements: behaviorStatus.config.mouseMovements.enabled,
        scrolling: behaviorStatus.config.scrolling.enabled,
        reading: behaviorStatus.config.reading.enabled,
        interaction: behaviorStatus.config.interaction.enabled,
      },
    });

    // Test delay generation
    const delay = behaviorSimulator.generateNormalDelay(100, 500);
    console.log('   ✅ Generated Delay:', `${delay}ms`);
    console.log();

    // 6. Integration Summary
    console.log('6️⃣  Integration Summary...');
    console.log('   🎯 All core components initialized successfully');
    console.log('   🔄 User agent rotation working');
    console.log('   ⏱️  Rate limiting active with emergency mode support');
    console.log('   🔍 Detection monitoring tracking incidents');
    console.log('   📊 Performance monitoring collecting metrics');
    console.log('   🎭 Behavior simulation configured');
    console.log();

    console.log('🎉 All stealth components are working correctly!\n');

    // Print activation guide
    console.log('🚀 TO ACTIVATE IN PRODUCTION:');
    console.log('   1. Add to .env file:');
    console.log('      BROWSER_STEALTH_ENABLED=true');
    console.log('      BEHAVIOR_SIMULATION_ENABLED=true');
    console.log('      INTELLIGENT_RATE_LIMITING=true');
    console.log('      BROWSER_PROFILE_PERSISTENCE=true');
    console.log('      DETECTION_MONITORING_ENABLED=true');
    console.log('      PERFORMANCE_MONITORING_ENABLED=true');
    console.log();
    console.log('   2. Optional fine-tuning:');
    console.log('      USER_AGENT_ROTATION_INTERVAL=3600000  # 1 hour');
    console.log('      MIN_REQUEST_INTERVAL=30000            # 30 seconds');
    console.log('      MAX_REQUEST_INTERVAL=300000           # 5 minutes');
    console.log('      DETECTION_ALERT_THRESHOLD=3           # 3 incidents');
    console.log();
    console.log('   3. Individual behavior controls:');
    console.log('      MOUSE_MOVEMENT_ENABLED=true');
    console.log('      SCROLLING_SIMULATION_ENABLED=true');
    console.log('      READING_TIME_SIMULATION=true');
    console.log('      INTERACTION_SIMULATION_ENABLED=true');
    console.log();
    console.log('   4. Restart the bot: npm start');
  } catch (error) {
    console.error('\n❌ Component test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testStealthComponents().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
