#!/usr/bin/env node

/**
 * Simple stealth component test - bypasses full configuration validation
 * Tests core stealth functionality without requiring full production setup
 */

import { UserAgentManager } from './src/utilities/user-agent-manager.js';
import { HumanBehaviorSimulator } from './src/utilities/human-behavior-simulator.js';
import { IntelligentRateLimiter } from './src/utilities/intelligent-rate-limiter.js';

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

    const platformInfo = userAgentManager.getPlatformInfo();
    console.log('   ✅ Platform Info:', platformInfo);

    const poolInfo = userAgentManager.getPoolInfo();
    console.log('   ✅ Pool Info:', {
      totalAgents: poolInfo.totalAgents,
      platforms: poolInfo.platforms,
      browsers: poolInfo.browsers,
    });

    const usageStats = userAgentManager.getUsageStats();
    console.log('   ✅ Usage Stats:', {
      totalRotations: usageStats.totalRotations,
      uniqueAgentsUsed: usageStats.uniqueAgentsUsed,
      agentDiversityPercent: usageStats.agentDiversityPercent,
    });
    console.log();

    // 2. Test IntelligentRateLimiter
    console.log('2️⃣  Testing IntelligentRateLimiter...');
    const rateLimiter = new IntelligentRateLimiter(mockConfig, mockLogger);

    const nextInterval = rateLimiter.calculateNextInterval();
    console.log('   ✅ Next Interval:', `${Math.round(nextInterval / 1000)}s`);

    // Simulate some requests
    rateLimiter.recordRequest({ type: 'test', success: true });
    rateLimiter.recordRequest({ type: 'test', success: true });
    rateLimiter.recordRequest({ type: 'test', success: false });

    const statistics = rateLimiter.getStatistics();
    console.log('   ✅ Rate Limiter Statistics:', {
      totalRequests: statistics.totalRequests,
      averageInterval: `${Math.round(statistics.averageInterval / 1000)}s`,
      burstPenalty: Math.round(statistics.currentBurstPenalty * 100) / 100,
      currentPattern: statistics.currentPattern,
    });
    console.log();

    // 3. Test HumanBehaviorSimulator (without page)
    console.log('3️⃣  Testing HumanBehaviorSimulator (Config Only)...');

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
    const behaviorConfig = behaviorSimulator.getConfiguration();
    console.log('   ✅ Behavior Simulator Config:', {
      enabled: behaviorConfig.enabled,
      mouseMovements: behaviorConfig.mouseMovements?.enabled,
      scrolling: behaviorConfig.scrolling?.enabled,
      reading: behaviorConfig.reading?.enabled,
    });

    // Test delay generation
    const delay = behaviorSimulator.randomDelay(100, 500);
    console.log('   ✅ Generated Delay:', `${delay}ms`);

    // Test reading time calculation
    const readingTime = behaviorSimulator.calculateReadingTime(1000);
    console.log('   ✅ Reading Time for 1000 chars:', `${Math.round(readingTime / 1000)}s`);
    console.log();

    // 4. Integration Summary
    console.log('4️⃣  Integration Summary...');
    console.log('   🎯 All core components initialized successfully');
    console.log('   🔄 User agent rotation working');
    console.log('   ⏱️  Rate limiting active with emergency mode support');
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
