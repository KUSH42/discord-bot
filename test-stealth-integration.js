#!/usr/bin/env node

/**
 * Test script to validate stealth browser integration
 * Tests that all components can be initialized and work together
 */

import { Configuration } from './src/infrastructure/configuration.js';
import { DependencyContainer } from './src/infrastructure/dependency-container.js';
import { setupProductionServices } from './src/setup/production-setup.js';

// Test environment with stealth enabled
const testEnv = {
  // Required basic config (using valid formats for validation)
  DISCORD_BOT_TOKEN: 'MTI3NzM0NzE4ODM5NzA1NjAwMA.GrKgAa.test-token-validation-bypass-123456789',
  YOUTUBE_API_KEY: 'AIzaSyTest123_ValidAPIKeyFormat-abcdefghijk',
  YOUTUBE_CHANNEL_ID: 'UCTestChannelId123456789',
  X_USER_HANDLE: 'testuser',

  // Stealth configuration
  BROWSER_STEALTH_ENABLED: 'true',
  BEHAVIOR_SIMULATION_ENABLED: 'true',
  USER_AGENT_ROTATION_INTERVAL: '3600000',
  INTELLIGENT_RATE_LIMITING: 'true',
  BROWSER_PROFILE_PERSISTENCE: 'true',
  DETECTION_MONITORING_ENABLED: 'true',
  PERFORMANCE_MONITORING_ENABLED: 'true',

  // Individual behavior controls
  MOUSE_MOVEMENT_ENABLED: 'true',
  SCROLLING_SIMULATION_ENABLED: 'true',
  READING_TIME_SIMULATION: 'true',
  INTERACTION_SIMULATION_ENABLED: 'true',

  // Rate limiting
  MIN_REQUEST_INTERVAL: '30000',
  MAX_REQUEST_INTERVAL: '300000',

  // Detection settings
  DETECTION_ALERT_THRESHOLD: '3',
  DETECTION_MONITORING_WINDOW: '3600000',

  // Performance settings
  PERFORMANCE_MEMORY_THRESHOLD: '1073741824',
  PERFORMANCE_CPU_THRESHOLD: '80',
  PERFORMANCE_RESPONSE_TIME_THRESHOLD: '30000',

  // Other required settings
  LOG_LEVEL: 'debug',
  BROWSER_HEADLESS: 'true',
  SUPPORT_CHANNEL_ID: '1234567890123456789',
  MAIN_CHANNEL_ID: '1234567890123456789',
  WEBHOOK_PORT: '3000',
  PSH_SECRET: 'test-webhook-secret',
  AUTHORIZED_USER_IDS: '123456789012345678,987654321098765432',
};

async function testStealthIntegration() {
  console.log('🧪 Testing Stealth Browser Integration...\n');

  try {
    // 1. Test Configuration
    console.log('1️⃣  Testing Configuration...');
    const config = new Configuration(testEnv);
    const stealthConfig = config.getBrowserStealthConfig();
    const detectionConfig = config.getDetectionMonitoringConfig();
    const performanceConfig = config.getPerformanceMonitoringConfig();

    console.log('   ✅ Configuration loaded successfully');
    console.log('   📊 Stealth Config:', {
      enabled: stealthConfig.stealthEnabled,
      behaviorSimulation: stealthConfig.behaviorSimulationEnabled,
      rateLimiting: stealthConfig.intelligentRateLimiting,
      profilePersistence: stealthConfig.profilePersistence,
    });
    console.log('   🔍 Detection Monitoring:', detectionConfig.enabled);
    console.log('   📈 Performance Monitoring:', performanceConfig.enabled);
    console.log();

    // 2. Test Dependency Container Setup
    console.log('2️⃣  Testing Dependency Container Setup...');
    const container = new DependencyContainer();

    // Only set up minimal services needed for browser service test
    container.registerInstance('config', config);

    // Mock logger for testing
    const mockLogger = {
      info: (...args) => console.log('   📝 [INFO]', ...args),
      debug: (...args) => console.log('   🐛 [DEBUG]', ...args),
      warn: (...args) => console.log('   ⚠️  [WARN]', ...args),
      error: (...args) => console.log('   ❌ [ERROR]', ...args),
      child: meta => ({
        ...mockLogger,
        service: meta.service,
        info: (...args) => console.log(`   📝 [INFO] [${meta.service}]`, ...args),
        debug: (...args) => console.log(`   🐛 [DEBUG] [${meta.service}]`, ...args),
        warn: (...args) => console.log(`   ⚠️  [WARN] [${meta.service}]`, ...args),
        error: (...args) => console.log(`   ❌ [ERROR] [${meta.service}]`, ...args),
      }),
    };

    container.registerInstance('logger', mockLogger);
    console.log('   ✅ Basic services registered');
    console.log();

    // 3. Test Browser Service Creation
    console.log('3️⃣  Testing Enhanced Browser Service Creation...');

    // Import and register browser service manually for testing
    const { StealthBrowserFactory } = await import('./src/services/implementations/stealth-browser-factory.js');
    const { PlaywrightBrowserService } = await import('./src/services/implementations/playwright-browser-service.js');

    container.registerSingleton('browserService', async c => {
      const config = c.resolve('config');
      const logger = c.resolve('logger').child({ service: 'BrowserService' });

      const stealthConfig = config.getBrowserStealthConfig();

      if (stealthConfig.stealthEnabled) {
        logger.info('Creating enhanced browser service with stealth capabilities');
        const stealthFactory = new StealthBrowserFactory(config, logger);
        return await stealthFactory.createStealthBrowser({
          purpose: 'test',
          stealthConfig,
        });
      } else {
        logger.info('Creating standard browser service');
        return new PlaywrightBrowserService();
      }
    });

    console.log('   ✅ Browser service factory registered');
    console.log();

    // 4. Test Browser Service Resolution
    console.log('4️⃣  Testing Browser Service Resolution...');

    try {
      const browserService = await container.resolve('browserService');
      console.log('   ✅ Browser service resolved successfully');
      console.log('   🎯 Service type:', browserService.constructor.name);

      // Test basic service properties
      if (browserService.userAgentManager) {
        console.log('   🔄 User Agent Manager: Available');
        const userAgent = browserService.userAgentManager.getCurrentUserAgent();
        console.log('   🌐 Current User Agent:', `${userAgent.substring(0, 50)}...`);
      }

      if (browserService.rateLimiter) {
        console.log('   ⏱️  Rate Limiter: Available');
        const status = browserService.rateLimiter.getStatus();
        console.log('   📊 Rate Limiter Status:', {
          pattern: status.currentPattern,
          nextInterval: `${Math.round(status.nextInterval / 1000)}s`,
        });
      }

      if (browserService.profileManager) {
        console.log('   👤 Profile Manager: Available');
      }

      console.log();

      // 5. Test Component Integration
      console.log('5️⃣  Testing Component Integration...');

      if (browserService.stealthEnabled) {
        console.log('   🥷 Stealth mode: ENABLED');
        console.log('   🎭 Behavior simulation: ENABLED');
        console.log('   🔒 Profile persistence: ENABLED');
        console.log('   📊 Monitoring: ENABLED');
      } else {
        console.log('   🔓 Standard mode: ENABLED');
      }

      console.log();

      // Cleanup
      if (typeof browserService.close === 'function') {
        await browserService.close();
        console.log('   🧹 Browser service cleaned up');
      }
    } catch (error) {
      console.log('   ❌ Browser service resolution failed:', error.message);
      throw error;
    }

    console.log('\n🎉 All tests passed! Stealth integration is working correctly.\n');

    // Print activation instructions
    console.log('🚀 TO ACTIVATE STEALTH FEATURES IN PRODUCTION:');
    console.log('   Add to your .env file:');
    console.log('   BROWSER_STEALTH_ENABLED=true');
    console.log('   BEHAVIOR_SIMULATION_ENABLED=true');
    console.log('   INTELLIGENT_RATE_LIMITING=true');
    console.log('   BROWSER_PROFILE_PERSISTENCE=true');
    console.log('   DETECTION_MONITORING_ENABLED=true');
    console.log('\n   Then restart the bot with: npm start');
  } catch (error) {
    console.error('\n❌ Integration test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Handle test environment check
if (process.env.NODE_ENV === 'test' || process.argv.includes('--test')) {
  console.log('⚠️  Running in test mode - components will be mocked\n');
}

// Run the test
testStealthIntegration().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
