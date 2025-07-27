# Enhanced Logging Integration Example

This document shows how to integrate the enhanced logging system into existing modules.

- Module-based debug categories (please add current status):
  - `content-announcer`: Content announcement pipeline detailed logging
  - `scraper`: X scraping operations and browser interactions
  - `youtube`: YouTube monitoring and webhook processing
  - `browser`: Browser automation, stealth operations, and anti-detection
  - `auth`: Authentication flows and session management
  - `performance`: Performance metrics and timing data
  - `api`: External API calls (YouTube, Discord)
  - `state`: State management operations
  - `rate-limiting`: Rate limiting and throttling operations

**Configuration**:
```javascript
// Environment variable support
DEBUG_FLAGS=content-announcer,scraper,performance

// Runtime toggle via state manager
debugFlags: {
  'content-announcer': true,
  'scraper': false,
  'youtube': true,
  // ...
}
```

## Before and After Comparison

### Before: Basic Logging (ContentAnnouncer)

```javascript
export class ContentAnnouncer {
  constructor(discordService, config, stateManager, logger) {
    this.discord = discordService;
    this.config = config;
    this.state = stateManager;
    this.logger = logger; // Basic Winston logger
  }

  async announceContent(content, options = {}) {
    const startTime = Date.now();
    
    this.logger.debug('🔄 Starting content announcement process', {
      contentSummary: { platform: content?.platform, type: content?.type },
      options,
    });

    try {
      // ... announcement logic ...
      const duration = Date.now() - startTime;
      this.logger.info('✅ Content announced successfully', { 
        channelId, 
        messageId, 
        duration 
      });
      
      return { success: true, channelId, messageId };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('❌ Failed to announce content', { 
        error: error.message, 
        duration 
      });
      throw error;
    }
  }
}
```

### After: Enhanced Logging (ContentAnnouncer)

```javascript
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

export class ContentAnnouncer {
  constructor(discordService, config, stateManager, baseLogger, debugManager, metricsManager) {
    this.discord = discordService;
    this.config = config;
    this.state = stateManager;
    
    // Create enhanced logger for this module
    this.logger = createEnhancedLogger(
      'content-announcer', 
      baseLogger, 
      debugManager, 
      metricsManager
    );
  }

  async announceContent(content, options = {}) {
    // Start tracked operation with automatic timing and correlation
    const operation = this.logger.startOperation('announceContent', {
      platform: content?.platform,
      type: content?.type,
      contentId: content?.id,
      channelId: this.getChannelId(content.platform, content.type)
    });

    try {
      // Log progress with automatic correlation
      operation.progress('Validating content structure');
      const validation = this.validateContent(content);
      if (!validation.success) {
        throw new Error(`Content validation failed: ${validation.error}`);
      }

      operation.progress('Formatting announcement message');
      const message = this.formatMessage(content, options);
      
      operation.progress('Sending to Discord channel');
      const result = await this.discord.sendMessage(channelId, message);
      
      // Mark as successful with automatic timing and metrics
      return operation.success('Content announced successfully', {
        channelId: result.channelId,
        messageId: result.messageId,
        messageLength: message.length
      });
      
    } catch (error) {
      // Mark as failed with automatic timing and metrics
      operation.error(error, 'Failed to announce content', {
        contentTitle: content?.title?.substring(0, 50),
        attemptedChannel: this.getChannelId(content.platform, content.type)
      });
      throw error;
    }
  }

  async processContentBatch(contentList) {
    // Create logger for batch operation with correlation ID
    const batchLogger = this.logger.forOperation('processContentBatch');
    
    batchLogger.info(`Processing content batch`, { 
      batchSize: contentList.length 
    });

    const results = [];
    for (const [index, content] of contentList.entries()) {
      const itemLogger = batchLogger.child({ 
        batchIndex: index, 
        totalItems: contentList.length 
      });
      
      try {
        const result = await this.announceContent(content);
        itemLogger.info('Batch item processed successfully');
        results.push({ success: true, result });
      } catch (error) {
        itemLogger.error('Batch item failed', { error: error.message });
        results.push({ success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    batchLogger.info('Batch processing completed', {
      successCount,
      failureCount: results.length - successCount,
      successRate: Math.round((successCount / results.length) * 100)
    });

    return results;
  }
}
```

## Integration Steps

### 1. Update Constructor Dependencies

Add the enhanced logging dependencies to your module constructor:

```javascript
// Before
constructor(discordService, config, stateManager, logger) {

// After  
constructor(discordService, config, stateManager, baseLogger, debugManager, metricsManager) {
  // Create enhanced logger instance
  this.logger = createEnhancedLogger(
    'your-module-name', 
    baseLogger, 
    debugManager, 
    metricsManager
  );
}
```

### 2. Replace Manual Timing with Operations

```javascript
// Before
const startTime = Date.now();
try {
  // ... operation logic ...
  const duration = Date.now() - startTime;
  this.logger.info('Operation completed', { duration });
} catch (error) {
  const duration = Date.now() - startTime;
  this.logger.error('Operation failed', { error: error.message, duration });
}

// After
const operation = this.logger.startOperation('operationName', { contextData });
try {
  // ... operation logic ...
  operation.success('Operation completed successfully', { additionalData });
} catch (error) {
  operation.error(error, 'Operation failed', { contextData });
}
```

### 3. Add Progress Tracking

For long-running operations, add progress tracking:

```javascript
const operation = this.logger.startOperation('complexOperation', { id });

operation.progress('Step 1: Validation');
await this.validateInput();

operation.progress('Step 2: Processing');
await this.processData();

operation.progress('Step 3: Saving');
await this.saveResults();

operation.success('All steps completed');
```

### 4. Use Correlation IDs for Related Operations

```javascript
// Create correlated loggers for related operations
const correlationId = this.logger.generateCorrelationId();
const parentLogger = this.logger.forOperation('parentOperation', correlationId);

// Pass correlation to child operations
await this.childOperation1(data, correlationId);
await this.childOperation2(data, correlationId);

// Child operations use the same correlation ID
async childOperation1(data, correlationId) {
  const logger = this.logger.forOperation('childOperation1', correlationId);
  const operation = logger.startOperation('childOp1', { data });
  // ... operation logic ...
}
```

### 5. Update Dependency Injection

Update your dependency container to provide the enhanced logging components:

```javascript
// In dependency-container.js
import { DebugFlagManager } from './infrastructure/debug-flag-manager.js';
import { MetricsManager } from './infrastructure/metrics-manager.js';

// Create managers
const debugManager = new DebugFlagManager(stateManager, logger);
const metricsManager = new MetricsManager({
  retentionHours: 24,
  maxSamplesPerMetric: 10000
});

// Update service creation
const contentAnnouncer = new ContentAnnouncer(
  discordService,
  config,
  stateManager,
  logger,           // base logger
  debugManager,     // debug flag manager
  metricsManager    // metrics manager
);
```

## Benefits of Enhanced Logging

### 1. Automatic Timing and Metrics
- Operations are automatically timed
- Success/failure rates are tracked
- Performance metrics are collected

### 2. Correlation Tracking
- Related operations share correlation IDs
- Easy to trace requests across modules
- Simplified debugging of complex workflows

### 3. Granular Debug Control
- Enable/disable debug logging per module
- Set different verbosity levels per module
- Runtime configuration without restarts

### 4. Rich Context
- Automatic sanitization of sensitive data
- Structured logging with consistent metadata
- Operation-specific context preservation

### 5. Performance Insights
- Real-time performance metrics
- Historical trend analysis
- Bottleneck identification

## Module Migration Checklist

- [ ] Update constructor to accept enhanced logging dependencies
- [ ] Replace manual timing with operation tracking
- [ ] Add progress tracking for long operations
- [ ] Implement correlation ID passing for related operations
- [ ] Update dependency injection configuration
- [ ] Test debug flag toggling works correctly
- [ ] Verify metrics are being collected
- [ ] Check that correlation IDs flow through operations
- [ ] Validate sensitive data is being sanitized
- [ ] Confirm performance impact is minimal

## Performance Considerations

### Memory Usage
- Enhanced logging uses more memory for operation tracking
- Metrics collection adds overhead
- Configure retention periods appropriately

### CPU Impact
- Minimal overhead for operation tracking (~1-2% CPU)
- Debug level filtering reduces unnecessary work
- Metrics aggregation runs asynchronously

### Storage Impact
- Metrics are stored in memory with configurable retention
- Debug flags are persisted in state manager
- Consider external metrics export for long-term storage

## Monitoring the Enhanced Logging System

Use the new Discord commands to monitor the system:

```
!debug-status              # Check which modules have debug enabled
!debug content-announcer true  # Enable debug for content announcer
!debug-level scraper 5     # Set scraper to verbose logging
!metrics                   # View performance metrics
!log-pipeline              # View recent pipeline activities
```