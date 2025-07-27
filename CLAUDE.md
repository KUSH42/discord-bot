# CLAUDE.md - Compact Guide

## Core Architecture

**Discord Content Announcement Bot** - Monitors YouTube/X content, announces to Discord channels.

### Key Components
- **Application Layer**: `src/application/` - MonitorApplication, ScraperApplication, AuthManager
- **Core Layer**: `src/core/` - CommandProcessor, ContentAnnouncer, ContentClassifier  
- **Infrastructure**: `src/infrastructure/` - DependencyContainer, EventBus, StateManager, DebugFlagManager, MetricsManager
- **Services**: `src/services/` - YouTube API, browser automation, external integrations
- **Utilities**: `src/utilities/` - EnhancedLogger, UTC time utilities, AsyncMutex

### Data Flow
- **Commands**: Discord → CommandProcessor → StateManager → Response
- **YouTube**: PubSubHubbub webhook → MonitorApplication → ContentAnnouncer → Discord
- **X Monitoring**: ScraperApplication → AuthManager → Browser → ContentClassifier → Discord

## Development Standards

### Technology Stack
- **Primary**: JavaScript ES6+, Node.js, Discord.js v14, Express.js
- **Testing**: Jest, Winston logging, Playwright/Puppeteer browser automation
- **Infrastructure**: Systemd services, Docker, GitHub Actions CI/CD
- **Security**: dotenvx credential encryption, HMAC verification

### Code Style
- **ES6+ modules**, no CommonJS
- **PascalCase** classes, **camelCase** methods/variables, **SCREAMING_SNAKE_CASE** constants
- **kebab-case** files/directories
- 120 char line limit, ESLint + Prettier required

### JSDoc Documentation
Required for all public methods:
```javascript
/**
 * Process a Discord command and return execution result
 * @param {string} command - Command name (without prefix)
 * @param {Array<string>} args - Command arguments
 * @param {string} userId - Discord user ID who issued the command
 * @returns {Promise<Object>} Command result with success, message, and metadata
 */
```

### Error Handling
- Use `async/await`, not Promise chains
- Log with Winston at appropriate boundaries
- Provide user-friendly Discord messages

### Timezone Safety
- **Always use UTC** for timestamp storage and business logic
- Use UTC utility functions from `src/utilities/utc-time.js`
- ESLint rules enforce UTC usage and prevent timezone bugs

```javascript
try {
  const result = await this.youtubeService.getVideoDetails(videoId);
  return result;
} catch (error) {
  this.logger.error('Failed to fetch YouTube video details', {
    videoId, error: error.message, stack: error.stack
  });
  throw new Error(`Unable to retrieve video information: ${error.message}`);
}
```

### Browser Automation
- Use `AsyncMutex` for operation synchronization
- Validate browser/page health before operations
- Implement graceful shutdown with `isShuttingDown` flags
- Use `setTimeout` instead of `page.waitForTimeout` for retries

### Performance Guidelines
- **Memory Management**: Monitor usage, implement cleanup for long-running processes
- **API Efficiency**: Batch calls when possible, implement caching
- **Async Operations**: Use Promise.all() for parallel operations when safe
- **Resource Cleanup**: Disposal patterns for browser instances and connections

### Security
- Validate all inputs, never log secrets
- Use dotenvx encryption for production credentials
- Implement rate limiting for commands/webhooks
- Verify webhook signatures with HMAC

### Timezone Safety
- **Always use UTC** for timestamp storage and business logic
- Use UTC utility functions from `src/utilities/utc-time.js`:
  - `nowUTC()`, `timestampUTC()`, `toISOStringUTC()` for current time
  - `getCurrentHourUTC()`, `getCurrentDayUTC()` for business logic
  - `daysAgoUTC()`, `hoursAgoUTC()` for time arithmetic
- ESLint rules automatically enforce UTC usage
- Store all timestamps as ISO strings with UTC timezone (`toISOString()`)

## Testing Requirements

### Coverage Thresholds
- **Global**: 25% statements/lines, 20% branches, 25% functions
- **Core modules**: 50% statements/lines, 40% branches, 55% functions
- **Critical components**: 85-90% coverage

### Test Organization
- `tests/unit/` - Individual functions/classes with mocking
- `tests/integration/` - Service interactions, API endpoints
- `tests/e2e/` - Complete user workflows
- `tests/performance/` - Benchmarks and bottlenecks
- `tests/security/` - Input validation, security controls

### Key Testing Patterns
```javascript
// Async callback handling
const flushPromises = async () => {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};

// Timer testing
jest.useFakeTimers();
await jest.runAllTimersAsync();
jest.useRealTimers();

// Proper mock setup
beforeEach(() => {
  service = new Service(dependencies);
  jest.spyOn(service, 'method').mockResolvedValue(result);
});
```

## Essential Commands

### Development
```bash
npm start                 # Start bot with validation
npm run decrypt          # Start with encrypted credentials
npm test                 # Full test suite with coverage
npm run test:dev         # Development mode (fast feedback)
npm run test:watch       # Watch mode for development
npm run lint:fix         # Fix ESLint issues
```

### Development Workflow
1. **Before Changes**: Run `npm test` for baseline stability
2. **During Development**: Use `npm run test:dev` or `npm run test:watch`
3. **Fast Iteration**: Use `npm run test:changed` for modified files only
4. **Code Quality**: Run `npm run lint:fix` before committing
5. **Testing**: Add tests for new functionality before implementation
6. **Coverage**: Ensure new code meets coverage thresholds

### Discord Bot Commands
- `!health` - Basic health status
- `!announce <true|false>` - Toggle announcements
- `!restart` - Full bot restart (authorized users)
- `!auth-status` - X authentication status
- `!readme` - Command help

### Adding New Commands (6-Step Process)
1. Add command name to `processCommand` switch statement
2. Implement handler method (e.g., `handleNewCommand`)
3. Add input validation in `validateCommand` method
4. Update `getStats()` method with new command
5. Add command to `handleReadme()` documentation
6. Create comprehensive unit tests

## Enhanced Logging System ✅ FULLY OPERATIONAL

### Core Components (All Implemented)
- **DebugFlagManager** (`src/infrastructure/debug-flag-manager.js`): ✅ Module-specific debug controls
- **MetricsManager** (`src/infrastructure/metrics-manager.js`): ✅ Performance metrics collection
- **EnhancedLogger** (`src/utilities/enhanced-logger.js`): ✅ Advanced logging with correlation tracking

### Debug Modules (9 total) - All Operational
- `content-announcer` ✅, `scraper`, `youtube`, `browser`, `auth`, `performance`, `api`, `state`, `rate-limiting`

### Debug Commands - All Working
- `!debug <module> <true|false>` ✅ - Toggle debug per module
- `!debug-status` ✅ - Show all module debug status
- `!debug-level <module> <1-5>` ✅ - Set debug granularity (1=errors, 5=verbose)
- `!metrics` ✅ - Performance metrics and system stats
- `!log-pipeline` ✅ - Recent operations with correlation tracking

### Environment Variables
```bash
DEBUG_FLAGS=content-announcer,scraper,performance
DEBUG_LEVEL_SCRAPER=5
DEBUG_LEVEL_BROWSER=1
```

### Enhanced Logger Usage (Ready for All Modules)
```javascript
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

const logger = createEnhancedLogger('module-name', baseLogger, debugManager, metricsManager);

// Automatic operation tracking
const operation = logger.startOperation('operationName', { context });
operation.progress('Step 1 completed');
operation.success('Operation completed', { result });
// or
operation.error(error, 'Operation failed', { context });

// Correlation tracking
const correlatedLogger = logger.forOperation('batchProcess', correlationId);
```

### Integration Status
- ✅ **ContentAnnouncer**: Fully integrated with enhanced logging
- 🚧 **Other Modules**: Ready for integration using same pattern

### Integration Benefits (All Available Now)
- **Runtime Debug Control**: ✅ No restarts needed for debug changes
- **Performance Monitoring**: ✅ Real-time metrics with Discord integration
- **Correlation Tracking**: ✅ Follow operations across modules
- **Security**: ✅ Automatic sensitive data sanitization

## Content Monitoring

### Multi-Source Detection (Priority Order)
1. **Webhooks** - PubSubHubbub push notifications (highest)
2. **API Polling** - YouTube Data API v3 queries (medium)
3. **Web Scraping** - Playwright browser automation (lowest)

### Enhanced Processing Pipeline
1. Multi-source detection → ContentCoordinator (race condition prevention)
2. Source priority resolution → ContentStateManager (unified tracking)
3. Enhanced duplicate detection → LivestreamStateMachine (state transitions)
4. Content classification → Announcement formatting → Discord channels

### Key Processing Components
- **ContentStateManager** (`src/core/content-state-manager.js`): Unified content state with persistent storage
- **LivestreamStateMachine** (`src/core/livestream-state-machine.js`): Handles livestream transitions
- **ContentCoordinator** (`src/core/content-coordinator.js`): Prevents race conditions between sources
- **PersistentStorage** (`src/infrastructure/persistent-storage.js`): File-based storage for content states

### Browser Configuration
**Anti-bot detection**: Use `headless: false` with Xvfb virtual display

**Safe browser args**:
```javascript
args: [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
  '--disable-gpu', '--disable-images', '--disable-plugins', '--mute-audio'
]
```

**Avoid these flags** (trigger detection):
- `--disable-web-security`, `--disable-extensions`, `--disable-ipc-flooding-protection`

## Critical Safety Guards

### Memory Leak Prevention
All `main()` functions include:
```javascript
if (process.env.NODE_ENV === 'test') {
  throw new Error('main() should not be called in test environment');
}
```

**Never call `main()` in tests** - they start infinite background processes.

### Autonomy Boundaries
**Requires Human Review**: Authentication mechanisms, webhook security, breaking changes to Discord commands, major architectural shifts

**Full Autonomy**: New bot commands, content filtering improvements, duplicate detection, test coverage, documentation, performance optimizations

## Environment Configuration

### Key Variables
- **Discord**: `DISCORD_BOT_TOKEN`, channel IDs, user authorizations
- **YouTube**: `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, webhook config
- **X Monitoring**: `X_USER_HANDLE`, authentication credentials
- **Security**: `PSH_SECRET`, rate limiting configuration
- **Anti-botting**: `BROWSER_STEALTH_ENABLED`, detection thresholds, profile management

### Health Monitoring
- `GET /health` - Basic status
- `GET /health/detailed` - Comprehensive component status
- Discord commands for real-time monitoring

### Configuration Validation
- **Startup Validation**: `src/config-validator.js` validates required variables
- **Type Checking**: Ensure proper data types and formats
- **Security Checks**: Verify sensitive values are encrypted
- **Default Values**: Provide sensible defaults where appropriate

## Deployment & Operations

### Systemd Service Management
```bash
sudo systemctl start discord-bot.service    # Start service
sudo systemctl status discord-bot.service   # Check status
sudo systemctl stop discord-bot.service     # Stop service
sudo systemctl daemon-reload                # Reload after changes
```

### Logging Infrastructure
- **File Logging**: Winston with daily rotation
- **Discord Logging**: Optional log mirroring to Discord channel
- **Log Levels**: error, warn, info, debug, verbose
- **Structured Logging**: JSON format with contextual metadata

---

*This compact guide covers essential development patterns. Reference the full CLAUDE.md for comprehensive details.*