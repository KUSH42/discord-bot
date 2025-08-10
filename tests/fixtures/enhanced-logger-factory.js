/**
 * Enhanced Logger Mock Factory
 * Provides reusable mocks for the enhanced logging system
 */

import { jest } from '@jest/globals';

export const createEnhancedLoggerMocks = () => {
  const mockDebugManager = {
    isEnabled: jest.fn(() => false),
    getLevel: jest.fn(() => 1),
    toggleFlag: jest.fn(),
    setLevel: jest.fn(),
  };

  const mockMetricsManager = {
    recordMetric: jest.fn(),
    startTimer: jest.fn(() => ({ end: jest.fn() })),
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
  };

  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn(function () {
      return this;
    }), // Ensure 'this' context is maintained
    startOperation: jest.fn(() => ({
      progress: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
    })),
  };

  return {
    debugManager: mockDebugManager,
    metricsManager: mockMetricsManager,
    logger: mockLogger,
    baseLogger: mockLogger, // Add baseLogger alias for backward compatibility
  };
};

export const createMockContentCoordinator = (defaultResponse = { success: true }) => ({
  processContent: jest.fn().mockResolvedValue(defaultResponse),
});
