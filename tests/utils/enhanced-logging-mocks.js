import { jest } from '@jest/globals';

/**
 * Factory for creating mock Winston logger with enhanced logging support
 * Provides .child() method required by EnhancedLogger
 */
export function createMockWinstonLogger() {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
    verbose: jest.fn(),
    // Essential: child method required by EnhancedLogger
    child: jest.fn().mockReturnThis(),
  };

  // Make child() return the same mock logger so test expectations work
  mockLogger.child.mockImplementation(() => mockLogger);

  return mockLogger;
}

/**
 * Factory for creating mock DebugFlagManager
 */
export function createMockDebugFlagManager() {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    setFlag: jest.fn(),
    getLevel: jest.fn().mockReturnValue(5), // Verbose level to allow all logging
    setLevel: jest.fn(),
    getAllFlags: jest.fn().mockReturnValue({}),
    initializeFromEnvironment: jest.fn(),
    shouldLog: jest.fn().mockReturnValue(true), // Essential: shouldLog method must return true
  };
}

/**
 * Factory for creating mock MetricsManager
 */
export function createMockMetricsManager() {
  const mockTimer = {
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnValue(100),
    elapsed: jest.fn().mockReturnValue(100),
  };

  return {
    timer: jest.fn().mockReturnValue(mockTimer),
    counter: jest.fn().mockReturnValue({
      increment: jest.fn(),
      decrement: jest.fn(),
      getValue: jest.fn().mockReturnValue(0),
    }),
    gauge: jest.fn().mockReturnValue({
      set: jest.fn(),
      getValue: jest.fn().mockReturnValue(0),
    }),
    histogram: jest.fn().mockReturnValue({
      update: jest.fn(),
      getStats: jest.fn().mockReturnValue({ mean: 0, p95: 0 }),
    }),
    getMetrics: jest.fn().mockReturnValue({}),
    resetMetrics: jest.fn(),
    // Essential: methods required by EnhancedLogger
    recordTiming: jest.fn(),
    incrementCounter: jest.fn(),
  };
}

/**
 * Factory for creating mock EnhancedLogger with all required methods
 * This mocks the behavior of createEnhancedLogger()
 */
export function createMockEnhancedLogger(moduleName = 'test-module') {
  const mockOperation = {
    progress: jest.fn(),
    success: jest.fn().mockReturnValue({ success: true }),
    error: jest.fn(),
    name: 'test-operation',
    correlationId: 'test-correlation-id',
    context: {},
  };

  const mockLogger = {
    // Standard Winston methods
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
    verbose: jest.fn(),

    // Enhanced logger specific methods
    startOperation: jest.fn().mockReturnValue(mockOperation),
    generateCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
    forOperation: jest.fn().mockReturnThis(),
    child: jest.fn().mockReturnThis(),

    // Properties
    moduleName,
    baseLogger: createMockWinstonLogger(),
  };

  // Make child and forOperation return new instances
  mockLogger.child.mockImplementation(() => createMockEnhancedLogger(moduleName));
  mockLogger.forOperation.mockImplementation(() => createMockEnhancedLogger(moduleName));

  return mockLogger;
}

/**
 * Complete mock setup for modules using enhanced logging
 * Returns all mocks needed for enhanced logging integration
 */
export function createEnhancedLoggingMocks() {
  const mockBaseLogger = createMockWinstonLogger();
  const mockDebugManager = createMockDebugFlagManager();
  const mockMetricsManager = createMockMetricsManager();
  const mockEnhancedLogger = createMockEnhancedLogger();

  return {
    mockBaseLogger,
    mockDebugManager,
    mockMetricsManager,
    mockEnhancedLogger,
  };
}

/**
 * Utility to mock the createEnhancedLogger function
 * Use this to mock the import in test files
 */
export function mockCreateEnhancedLogger() {
  return jest.fn().mockImplementation(moduleName => {
    return createMockEnhancedLogger(moduleName);
  });
}

/**
 * Mock dependencies object for services that use enhanced logging
 * Provides consistent mock structure across test files
 */
export function createMockDependenciesWithEnhancedLogging(additionalMocks = {}) {
  const enhancedMocks = createEnhancedLoggingMocks();

  return {
    logger: enhancedMocks.mockBaseLogger,
    debugManager: enhancedMocks.mockDebugManager,
    metricsManager: enhancedMocks.mockMetricsManager,
    ...additionalMocks,
  };
}
