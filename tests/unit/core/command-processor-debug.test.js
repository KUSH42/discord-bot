import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CommandProcessor } from '../../../src/core/command-processor.js';
import { StateManager } from '../../../src/infrastructure/state-manager.js';

describe('CommandProcessor - Debug Commands', () => {
  let commandProcessor;
  let mockConfig;
  let stateManager;
  let mockDebugManager;
  let mockMetricsManager;
  let mockMemoryMonitor;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn((key, defaultValue) => {
        const values = {
          COMMAND_PREFIX: '!',
          ALLOWED_USER_IDS: '123456789012345678,user456',
        };
        return values[key] || defaultValue;
      }),
      getRequired: jest.fn(),
    };

    stateManager = new StateManager();

    mockDebugManager = {
      getAvailableModules: jest.fn(() => ['content-announcer', 'scraper', 'youtube']),
      toggle: jest.fn(),
      setLevel: jest.fn(),
      getStatus: jest.fn(() => ({
        modules: {
          'content-announcer': { enabled: true, level: 4, levelName: 'debug' },
          scraper: { enabled: false, level: 3, levelName: 'info' },
          youtube: { enabled: true, level: 5, levelName: 'verbose' },
        },
        enabledCount: 2,
        totalCount: 3,
      })),
      getStats: jest.fn(() => ({
        totalModules: 3,
        enabledModules: 2,
        enabledPercentage: 67,
      })),
      getDebugLevels: jest.fn(() => ({
        'content-announcer': 4,
        scraper: 3,
        youtube: 5,
      })),
      getLevel: jest.fn(module => {
        const levels = { 'content-announcer': 4, scraper: 3, youtube: 5 };
        return levels[module] || 3;
      }),
      getLevelName: jest.fn(level => {
        const names = { 1: 'errors', 2: 'warnings', 3: 'info', 4: 'debug', 5: 'verbose' };
        return names[level] || 'unknown';
      }),
      isEnabled: jest.fn(() => true),
      getEnabledModules: jest.fn(() => ['content-announcer', 'youtube']),
    };

    mockMetricsManager = {
      getStats: jest.fn(() => ({
        uptime: 3661, // 1h 1m 1s
        totalMetricsRecorded: 12345,
        metricsPerSecond: 3.4,
        storage: {
          counters: 5,
          gauges: 3,
          timers: 7,
          histograms: 2,
        },
      })),
      getMemoryUsage: jest.fn(() => ({
        totalSamples: 1000,
        estimatedMB: 2.5,
      })),
      getMetrics: jest.fn(type => {
        if (type === 'counter') {
          return {
            'requests.total': { value: 1000 },
            'errors.total': { value: 42 },
          };
        }
        if (type === 'timer') {
          return {
            'request.duration': { stats: { mean: 150, p95: 300, count: 100 } },
            'db.query': { stats: { mean: 25, p95: 50, count: 200 } },
          };
        }
        return {};
      }),
    };

    mockMemoryMonitor = {
      getStats: jest.fn(() => ({
        peakMemoryMB: 256,
        averageMemoryMB: 128,
        gcExecutions: 5,
        warningsIssued: 2,
        contentStores: {
          tweetCache: {
            totalItems: 500,
            totalSizeMB: 12.5,
            oldestItemHours: 24,
          },
        },
        thresholds: {
          warningMB: 768,
          maxMB: 1024,
          gcMB: 512,
        },
      })),
      getDetailedContentAnalysis: jest.fn(() => ({
        recommendations: ['Sample recommendation'],
      })),
    };

    commandProcessor = new CommandProcessor(
      mockConfig,
      stateManager,
      mockDebugManager,
      mockMetricsManager,
      null, // baseLogger
      mockMemoryMonitor
    );
  });

  describe('debug command validation', () => {
    it('should validate debug command arguments', async () => {
      const result = await commandProcessor.processCommand('debug', ['content-announcer'], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid argument');
    });

    it('should validate unknown module names', async () => {
      const result = await commandProcessor.processCommand('debug', ['unknown-module', 'true'], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown debug module');
    });

    it('should validate boolean arguments', async () => {
      const result = await commandProcessor.processCommand(
        'debug',
        ['content-announcer', 'maybe'],
        '123456789012345678'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid argument');
    });

    it('should validate debug-level command arguments', async () => {
      const result = await commandProcessor.processCommand('debug-level', ['content-announcer'], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid debug level');
    });

    it('should validate debug level range', async () => {
      const result = await commandProcessor.processCommand(
        'debug-level',
        ['content-announcer', '6'],
        '123456789012345678'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid debug level');
    });
  });

  describe('debug command without arguments', () => {
    it('should show current debug status when no arguments provided', async () => {
      const result = await commandProcessor.processCommand('debug', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Enabled debug modules');
      expect(result.message).toContain('content-announcer, youtube');
    });

    it('should show usage when no modules enabled', async () => {
      mockDebugManager.getStatus.mockReturnValue({
        modules: {
          'content-announcer': { enabled: false, level: 3, levelName: 'info' },
        },
        enabledCount: 0,
        totalCount: 1,
      });

      const result = await commandProcessor.processCommand('debug', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('No debug modules currently enabled');
    });
  });

  describe('debug toggle command', () => {
    it('should enable debug for module', async () => {
      mockDebugManager.toggle.mockReturnValue(true);

      const result = await commandProcessor.processCommand(
        'debug',
        ['content-announcer', 'true'],
        '123456789012345678'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug logging **enabled** for: content-announcer');
      expect(mockDebugManager.toggle).toHaveBeenCalledWith('content-announcer', true);
    });

    it('should disable debug for module', async () => {
      mockDebugManager.toggle.mockReturnValue(false);

      const result = await commandProcessor.processCommand('debug', ['scraper', 'false'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug logging **disabled** for: scraper');
      expect(mockDebugManager.toggle).toHaveBeenCalledWith('scraper', false);
    });

    it('should handle debug manager errors', async () => {
      mockDebugManager.toggle.mockImplementation(() => {
        throw new Error('Debug manager error');
      });

      const result = await commandProcessor.processCommand(
        'debug',
        ['content-announcer', 'true'],
        '123456789012345678'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Errors: content-announcer: Debug manager error');
    });

    it('should handle missing debug manager', async () => {
      const processor = new CommandProcessor(mockConfig, stateManager, null, mockMetricsManager);

      const result = await processor.processCommand('debug', ['content-announcer', 'true'], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Debug manager is not available');
    });

    it('should enable debug for all modules globally', async () => {
      mockDebugManager.toggle.mockReturnValue(true);

      const result = await commandProcessor.processCommand('debug', ['true'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug logging **enabled** for **3** modules');
      expect(mockDebugManager.toggle).toHaveBeenCalledTimes(3);
      expect(mockDebugManager.toggle).toHaveBeenCalledWith('content-announcer', true);
      expect(mockDebugManager.toggle).toHaveBeenCalledWith('scraper', true);
      expect(mockDebugManager.toggle).toHaveBeenCalledWith('youtube', true);
    });

    it('should disable debug for all modules globally', async () => {
      mockDebugManager.toggle.mockReturnValue(false);

      const result = await commandProcessor.processCommand('debug', ['false'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug logging **disabled** for **3** modules');
      expect(mockDebugManager.toggle).toHaveBeenCalledTimes(3);
    });

    it('should enable debug for multiple specific modules', async () => {
      mockDebugManager.toggle.mockReturnValue(true);

      const result = await commandProcessor.processCommand(
        'debug',
        ['content-announcer', 'youtube', 'true'],
        '123456789012345678'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug logging **enabled** for: content-announcer, youtube');
      expect(mockDebugManager.toggle).toHaveBeenCalledTimes(2);
      expect(mockDebugManager.toggle).toHaveBeenCalledWith('content-announcer', true);
      expect(mockDebugManager.toggle).toHaveBeenCalledWith('youtube', true);
    });
  });

  describe('debug-status command', () => {
    it('should show debug status for all modules', async () => {
      const result = await commandProcessor.processCommand('debug-status', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug Status Summary');
      expect(result.message).toContain('Enabled: 2/3 modules (67%)');
      expect(result.message).toContain('✅ **content-announcer**: enabled (level 4: debug)');
      expect(result.message).toContain('❌ **scraper**: disabled (level 3: info)');
      expect(result.debugStatus).toBeDefined();
    });

    it('should handle debug manager errors', async () => {
      mockDebugManager.getStatus.mockImplementation(() => {
        throw new Error('Status error');
      });

      const result = await commandProcessor.processCommand('debug-status', [], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to get debug status');
    });
  });

  describe('debug-level command', () => {
    it('should show current debug levels when no arguments', async () => {
      const result = await commandProcessor.processCommand('debug-level', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Current Debug Levels');
      expect(result.message).toContain('**content-announcer**: 4 (debug)');
      expect(result.message).toContain('**scraper**: 3 (info)');
      expect(result.message).toContain('1=errors, 2=warnings, 3=info, 4=debug, 5=verbose');
    });

    it('should set debug level for module', async () => {
      mockDebugManager.setLevel.mockReturnValue(5);

      const result = await commandProcessor.processCommand(
        'debug-level',
        ['content-announcer', '5'],
        '123456789012345678'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug level set to **5** (verbose) for: content-announcer');
      expect(mockDebugManager.setLevel).toHaveBeenCalledWith('content-announcer', 5);
    });

    it('should handle debug manager errors', async () => {
      mockDebugManager.setLevel.mockImplementation(() => {
        throw new Error('Level error');
      });

      const result = await commandProcessor.processCommand(
        'debug-level',
        ['content-announcer', '5'],
        '123456789012345678'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Errors: content-announcer: Level error');
    });

    it('should set debug level for all modules globally', async () => {
      mockDebugManager.setLevel.mockReturnValue(3);

      const result = await commandProcessor.processCommand('debug-level', ['3'], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug level set to **3** (info) for **3** modules');
      expect(mockDebugManager.setLevel).toHaveBeenCalledTimes(3);
      expect(mockDebugManager.setLevel).toHaveBeenCalledWith('content-announcer', 3);
      expect(mockDebugManager.setLevel).toHaveBeenCalledWith('scraper', 3);
      expect(mockDebugManager.setLevel).toHaveBeenCalledWith('youtube', 3);
    });

    it('should set debug level for multiple specific modules', async () => {
      mockDebugManager.setLevel.mockReturnValue(4);

      const result = await commandProcessor.processCommand(
        'debug-level',
        ['content-announcer', 'youtube', '4'],
        '123456789012345678'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Debug level set to **4** (debug) for: content-announcer, youtube');
      expect(mockDebugManager.setLevel).toHaveBeenCalledTimes(2);
      expect(mockDebugManager.setLevel).toHaveBeenCalledWith('content-announcer', 4);
      expect(mockDebugManager.setLevel).toHaveBeenCalledWith('youtube', 4);
    });
  });

  describe('metrics command', () => {
    it('should show comprehensive metrics summary', async () => {
      const result = await commandProcessor.processCommand('metrics', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('📊 Metrics Summary');
      expect(result.message).toContain('⏱️ Uptime: 1h 1m');
      expect(result.message).toContain('📈 Total metrics recorded: 12,345');
      expect(result.message).toContain('⚡ Rate: 3.4 metrics/sec');
      expect(result.message).toContain('💾 Memory: 2.5 MB');
      expect(result.message).toContain('🔢 Counters: 5');
      expect(result.metricsData).toBeDefined();
    });

    it('should show top counters', async () => {
      const result = await commandProcessor.processCommand('metrics', [], '123456789012345678');

      expect(result.message).toContain('Top Counters');
      expect(result.message).toContain('**requests.total**: 1,000');
      expect(result.message).toContain('**errors.total**: 42');
    });

    it('should show timer performance', async () => {
      const result = await commandProcessor.processCommand('metrics', [], '123456789012345678');

      expect(result.message).toContain('Timer Performance');
      expect(result.message).toContain('**request.duration**: 150ms avg, 300ms p95');
      expect(result.message).toContain('**db.query**: 25ms avg, 50ms p95');
    });

    it('should handle missing metrics manager', async () => {
      const processor = new CommandProcessor(mockConfig, stateManager, mockDebugManager, null);

      const result = await processor.processCommand('metrics', [], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Metrics manager is not available');
    });

    it('should handle metrics manager errors', async () => {
      mockMetricsManager.getStats.mockImplementation(() => {
        throw new Error('Metrics error');
      });

      const result = await commandProcessor.processCommand('metrics', [], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to get metrics');
    });
  });

  describe('log-pipeline command', () => {
    it('should show pipeline information', async () => {
      const result = await commandProcessor.processCommand('log-pipeline', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('📋 Recent Pipeline Activities');
      expect(result.message).toContain('correlation tracking');
    });

    it('should show currently debugging modules', async () => {
      const result = await commandProcessor.processCommand('log-pipeline', [], '123456789012345678');

      expect(result.message).toContain('Currently Debugging');
      expect(result.message).toContain('**content-announcer**: level');
      expect(result.message).toContain('**youtube**: level');
    });

    it('should work without debug manager', async () => {
      const processor = new CommandProcessor(mockConfig, stateManager, null, mockMetricsManager);

      const result = await processor.processCommand('log-pipeline', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Pipeline Activities');
    });
  });

  describe('command stats integration', () => {
    it('should include debug commands in available commands', () => {
      const stats = commandProcessor.getStats();

      expect(stats.availableCommands).toContain('debug');
      expect(stats.availableCommands).toContain('debug-status');
      expect(stats.availableCommands).toContain('debug-level');
      expect(stats.availableCommands).toContain('metrics');
      expect(stats.availableCommands).toContain('log-pipeline');
    });
  });

  describe('readme integration', () => {
    it('should include debug commands in readme', async () => {
      const result = await commandProcessor.processCommand('readme', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('!debug <true|false>');
      expect(result.message).toContain('!debug <module1> <module2> ... <true|false>');
      expect(result.message).toContain('!debug-status');
      expect(result.message).toContain('!debug-level <1-5>');
      expect(result.message).toContain('!debug-level <module1> <module2> ... <1-5>');
      expect(result.message).toContain('!metrics');
      expect(result.message).toContain('!log-pipeline');
    });
  });

  describe('authorization', () => {
    it('should allow debug commands for any user', async () => {
      const result = await commandProcessor.processCommand(
        'debug',
        ['content-announcer', 'true'],
        '987654321098765432'
      );

      expect(result.success).toBe(true);
      expect(mockDebugManager.toggle).toHaveBeenCalled();
    });

    it('should allow metrics commands for any user', async () => {
      const result = await commandProcessor.processCommand('metrics', [], '987654321098765432');

      expect(result.success).toBe(true);
    });

    it('should allow memory-status commands for any user', async () => {
      const result = await commandProcessor.processCommand('memory-status', [], '987654321098765432');

      expect(result.success).toBe(true);
    });
  });

  describe('memory-status command', () => {
    beforeEach(() => {
      // Enhanced mock setup for comprehensive testing
      mockMemoryMonitor.getStats.mockReturnValue({
        peakMemoryMB: 256,
        averageMemoryMB: 128,
        gcExecutions: 5,
        warningsIssued: 2,
        contentStores: {
          tweetCache: {
            totalItems: 500,
            totalSizeMB: 12.5,
            oldestItemHours: 24,
          },
          videoCache: {
            totalItems: 200,
            totalSizeMB: 8.3,
            oldestItemHours: 48,
          },
        },
        thresholds: {
          warningMB: 768,
          maxMB: 1024,
          gcMB: 512,
        },
      });

      mockMemoryMonitor.getDetailedContentAnalysis.mockReturnValue({
        recommendations: [
          'tweetCache: Consider reducing cache size (500 items)',
          'Memory pressure detected - consider reducing cache sizes',
        ],
      });
    });

    it('should show comprehensive memory status', async () => {
      const result = await commandProcessor.processCommand('memory-status', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('💾 Memory Status Report');
      expect(result.message).toContain('📊 Peak: 256 MB | Avg: 128 MB');
      expect(result.message).toContain('⚠️ Warning: 768 MB | Max: 1024 MB');
      expect(result.message).toContain('🗑️ GC Executions: 5 | Warnings: 2');
      expect(result.message).toContain('📦 Content Stores:');
      expect(result.message).toContain('tweetCache**: 500 items, 12.5 MB');
      expect(result.message).toContain('videoCache**: 200 items, 8.3 MB');
      expect(result.message).toContain('💡 Recommendations:');
      expect(result.message).toContain('✅ **Status**: Healthy');
      expect(result.memoryData).toBeDefined();
    });

    it('should handle high memory usage status', async () => {
      // Mock current memory to exceed warning threshold
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn(() => ({
        heapUsed: 800 * 1024 * 1024, // 800MB (above warning threshold)
        heapTotal: 900 * 1024 * 1024,
        external: 50 * 1024 * 1024,
        rss: 950 * 1024 * 1024,
      }));

      const result = await commandProcessor.processCommand('memory-status', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('⚠️ **Status**: High Memory Usage');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should handle critical memory usage status', async () => {
      // Mock current memory to exceed max threshold
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn(() => ({
        heapUsed: 1100 * 1024 * 1024, // 1100MB (above max threshold)
        heapTotal: 1200 * 1024 * 1024,
        external: 50 * 1024 * 1024,
        rss: 1250 * 1024 * 1024,
      }));

      const result = await commandProcessor.processCommand('memory-status', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('🚨 **Status**: Critical Memory Usage');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should handle content store errors', async () => {
      mockMemoryMonitor.getStats.mockReturnValue({
        ...mockMemoryMonitor.getStats(),
        contentStores: {
          errorStore: {
            error: 'Failed to analyze store',
          },
        },
        thresholds: {
          warningMB: 768,
          maxMB: 1024,
          gcMB: 512,
        },
      });

      const result = await commandProcessor.processCommand('memory-status', [], '123456789012345678');

      expect(result.success).toBe(true);
      expect(result.message).toContain('❌ **errorStore**: Error - Failed to analyze store');
    });

    it('should handle missing memory monitor', async () => {
      // Create processor without memory monitor
      const processorWithoutMemory = new CommandProcessor(
        mockConfig,
        stateManager,
        mockDebugManager,
        mockMetricsManager
      );

      const result = await processorWithoutMemory.processCommand('memory-status', [], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('❌ Memory monitor is not available.');
    });

    it('should handle memory monitor errors', async () => {
      mockMemoryMonitor.getStats.mockImplementation(() => {
        throw new Error('Memory monitor error');
      });

      const result = await commandProcessor.processCommand('memory-status', [], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('❌ Failed to get memory status: Memory monitor error');
    });
  });

  describe('edge cases', () => {
    it('should handle empty module lists gracefully', async () => {
      mockDebugManager.getAvailableModules.mockReturnValue([]);

      const result = await commandProcessor.processCommand('debug', ['unknown', 'true'], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown debug module');
    });

    it('should handle malformed debug manager responses', async () => {
      mockDebugManager.getStatus.mockReturnValue(null);

      const result = await commandProcessor.processCommand('debug-status', [], '123456789012345678');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to get debug status');
    });

    it('should handle non-numeric debug levels', async () => {
      const result = await commandProcessor.processCommand(
        'debug-level',
        ['content-announcer', 'invalid'],
        '123456789012345678'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid debug level');
    });
  });
});
