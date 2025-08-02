# CLAUDE.md - Compact Guide

## Core Architecture

**Discord Content Announcement Bot** - Monitors YouTube/X content, announces to Discord channels.

### Key Components
- **Application Layer**: `src/application/` - MonitorApplication, ScraperApplication, XAuthManager
- **Core Layer**: `src/core/` - CommandProcessor, ContentAnnouncer, ContentClassifier  
- **Infrastructure**: `src/infrastructure/` - DependencyContainer, EventBus, StateManager, DebugFlagManager, MetricsManager
- **Services**: `src/services/` - YouTube API, browser automation, external integrations
- **Utilities**: `src/utilities/` - EnhancedLogger, UTC time utilities, AsyncMutex

### Data Flow
- **Commands**: Discord → CommandProcessor → StateManager → Response
- **YouTube**: PubSubHubbub webhook → MonitorApplication → ContentAnnouncer → Discord
- **X Monitoring**: ScraperApplication → XAuthManager → Browser → ContentClassifier → Discord

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

### Logging Objects
- **String Templates**: Use `${JSON.stringify(object)}` to properly log object contents
- **Enhanced Logger**: Objects as second parameter may not display properly - use JSON.stringify()
```javascript
// ❌ Incorrect - logs [object Object]
operation.success('Completed with stats', stats);

// ✅ Correct - shows actual object properties
operation.success(`Completed with stats: ${JSON.stringify(stats)}`);
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

## Testing

**📋 Comprehensive testing guidelines available in [`tests/CLAUDE.md`](tests/CLAUDE.md)**

### Key Points
- Coverage thresholds: 25% global, 50% core modules, 85-90% critical components
- Use `tests/fixtures/` utilities for consistent mocking and timer testing
- **Never run full test suites** - target specific files/patterns for efficiency
- Advanced timer testing utilities resolve complex async coordination issues

### Quick Commands
```bash
npm test                              # Full suite (only before commits)
npm test -- path/to/specific.test.js # Single test file
npm run test:watch                    # Development mode
```

## Essential Commands

### Development
```bash
npm start                # Start bot with validation
npm run decrypt          # Start with encrypted credentials
npm test                 # Full test suite with coverage
npm run test:dev         # Development mode (fast feedback)
npm run test:watch       # Watch mode for development
npm run lint:fix         # Fix ESLint issues
```

## Test Suite Status ✅ **ALL TESTS PASSING**

### Recently Fixed Issues (26 failing tests resolved)
**✅ Completed**: All major test failures have been systematically resolved

**High Priority Fixes (18 tests):**
- **Restart functionality timer issues (8 tests)** - Complex async timer coordination for health monitoring
- **Content detection timer issues (3 tests)** - Timer synchronization with proper Jest fake timer usage  
- **Process-tweet mock configuration issues (7 tests)** - Updated to ContentCoordinator pattern

**Medium Priority Fixes (6 tests):**
- **Tweet-processing mock issues (4 tests)** - Mock configurations updated for current architecture
- **Playwright-browser-service mock issues (2 tests)** - Added missing `isClosed()` and `isConnected()` methods

**Low Priority Fixes (2 tests):**
- **Monitor-application assertion issue (1 test)** - Fixed logging assertion with mock clearing
- **Content-announcer assertion issue (1 test)** - Updated for enhanced error messages

### Key Technical Solutions Applied
- **Advanced Timer Testing**: Implemented sophisticated patterns for complex `setInterval` + async callback operations
- **Mock Architecture Updates**: Aligned tests with ContentCoordinator pattern vs direct announcer calls
- **Enhanced Logger Integration**: Ensured all tests handle enhanced logging with operation tracking
- **Browser Mock Completeness**: Added complete Playwright browser API methods to test mocks

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
- **DebugFlagManager** (`src/infrastructure/debug-flag-manager.js`): ✅ Module-specific debug controls with 9 debug modules
- **MetricsManager** (`src/infrastructure/metrics-manager.js`): ✅ Real-time performance metrics collection (24hr retention)
- **EnhancedLogger** (`src/utilities/enhanced-logger.js`): ✅ Advanced logging with automatic operation tracking and correlation IDs

### Debug Modules (9 total) - All Operational
- `content-announcer` ✅, `scraper` ✅, `youtube` ✅, `browser`, `auth` ✅, `performance`, `api` ✅, `state`, `rate-limiting`

### Debug Commands - All Working
- `!debug <module> <true|false>` ✅ - Toggle debug per module with validation
- `!debug-status` ✅ - Show all module debug status with memory usage
- `!debug-level <module> <1-5>` ✅ - Set debug granularity (1=errors, 5=verbose)
- `!metrics` ✅ - Performance metrics, success rates, system health
- `!log-pipeline` ✅ - Recent operations with correlation tracking and timing

### Environment Configuration
```bash
DEBUG_FLAGS=content-announcer,scraper,performance
DEBUG_LEVEL_SCRAPER=5           # Verbose logging
DEBUG_LEVEL_BROWSER=1           # Errors only
METRICS_RETENTION_HOURS=24      # Metrics retention period
```

### Enhanced Logger Integration Pattern
```javascript
import { createEnhancedLogger } from '../utilities/enhanced-logger.js';

// 1. Update constructor to accept enhanced logging dependencies
constructor(dependencies..., baseLogger, debugManager, metricsManager) {
  this.logger = createEnhancedLogger('module-name', baseLogger, debugManager, metricsManager);
}

// 2. Use automatic operation tracking with timing and metrics
async someOperation(data) {
  const operation = this.logger.startOperation('operationName', { data });
  try {
    operation.progress('Step 1: Processing');
    // ... do work ...
    operation.success('Operation completed', { result });
    return result;
  } catch (error) {
    operation.error(error, 'Operation failed', { context });
    throw error;
  }
}

// 3. Use correlation IDs for related operations
const correlationId = this.logger.generateCorrelationId();
const parentLogger = this.logger.forOperation('parentOperation', correlationId);
```

### Integration Status (Production Ready)
#### ✅ Completed Integrations (6 modules)
- **ContentAnnouncer** (`content-announcer`): Content announcement pipeline with progress tracking
- **ScraperApplication** (`scraper`): X scraping operations with browser automation debugging
- **MonitorApplication** (`youtube`): YouTube webhook processing with API fallback monitoring  
- **BotApplication** (`api`): Discord message processing with command tracking
- **XAuthManager** (`auth`): Authentication flows with login attempt monitoring
- **YouTubeScraperService** (`youtube`): YouTube monitoring with better "Failed to scrape" error context

#### 🚧 Pending Integrations (Low Priority)
- **Browser Services** (`browser`): Playwright automation debugging
- **ContentCoordinator** (`state`): Content coordination visibility
- **ContentClassifier** (`api`): Classification process tracking
- **ContentStateManager** (`state`): State management operations

### Testing Framework (Fully Established)
```javascript
// Enhanced Logger mock pattern for tests
const mockDebugManager = {
  isEnabled: jest.fn(() => false),
  getLevel: jest.fn(() => 1),
  toggleFlag: jest.fn(),
  setLevel: jest.fn()
};

const mockMetricsManager = {
  recordMetric: jest.fn(),
  startTimer: jest.fn(() => ({ end: jest.fn() })),
  incrementCounter: jest.fn(),
  setGauge: jest.fn()
};

// All Phase 2 modules have updated test coverage with reusable mock patterns
```

### Performance & Security Features
- **Memory Impact**: ~1-2% additional memory per operation
- **CPU Overhead**: ~1-2% CPU for operation tracking
- **Automatic Data Sanitization**: Credentials and PII automatically redacted
- **Access Control**: Debug commands restricted to authorized users
- **Rate Limiting**: Debug command usage rate limited

### Integration Benefits (All Available Now)
- **Runtime Debug Control**: ✅ Toggle any of 9 modules without restarts
- **Performance Monitoring**: ✅ Real-time metrics with Discord integration
- **Correlation Tracking**: ✅ Follow operations across modules with correlation IDs
- **Rich Error Context**: ✅ Better debugging for "Failed to scrape" type errors
- **Operation Timing**: ✅ Automatic timing measurement for all tracked operations
- **Security**: ✅ Automatic sensitive data sanitization in logs

## Content Monitoring

### Multi-Source Detection (Priority Order)
1. **Webhooks** - PubSubHubbub push notifications (highest)
2. **API Polling** - YouTube Data API v3 queries (medium)
3. **Web Scraping** - Playwright browser automation (lowest)

### Enhanced Processing Pipeline ✅ **CONTENT COORDINATOR PATTERN**
1. Multi-source detection → **ContentCoordinator** (race condition prevention)
2. Source priority resolution → ContentStateManager (unified tracking)
3. Enhanced duplicate detection → LivestreamStateMachine (state transitions)
4. Content classification → **ContentCoordinator.processContent()** → Discord channels

**⚠️ Important**: Current implementation uses **ContentCoordinator pattern** instead of direct announcer calls:
```javascript
// ✅ CURRENT: Content flows through ContentCoordinator
const result = await this.contentCoordinator.processContent(content.id, 'scraper', content);

// ❌ DEPRECATED: Direct announcer calls (old pattern, don't use in new tests)
const result = await this.contentAnnouncer.announceContent(content);
```

**Test Expectations**: All tests should expect `contentCoordinator.processContent()` calls, not direct announcer calls.

### Key Processing Components
- **ContentStateManager** (`src/core/content-state-manager.js`): Unified content state with persistent storage
- **LivestreamStateMachine** (`src/core/livestream-state-machine.js`): Handles livestream transitions
- **ContentCoordinator** (`src/core/content-coordinator.js`): Prevents race conditions between sources
- **PersistentStorage** (`src/infrastructure/persistent-storage.js`): File-based storage for content states

### Browser Architecture & Configuration

#### Dual Browser Design
The application uses **separate browser instances** for X and YouTube scrapers to prevent resource conflicts:

- **X Scraper**: Independent PlaywrightBrowserService instance with isolated profile
- **YouTube Scraper**: Separate PlaywrightBrowserService instance with isolated profile
- **Dependency Injection**: Browser service registered as singleton but creates isolated instances per scraper
- **Profile Isolation**: Each browser gets unique temporary profile directory (e.g., `profile-r2iRG5`, `profile-xjXqsz`)

#### Browser Environment Requirements
**Display Server**: Requires Xvfb virtual display for headless operation
```bash
# Required for browser automation in headless environments
DISPLAY=:99 node index.js
```

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

#### Common Browser Issues & Solutions

**"Browser connection lost" Errors:**
- **Cause**: Missing X server environment or browser instance conflicts
- **Solution**: Ensure Xvfb is running and `DISPLAY=:99` is set
- **Verification**: Check for multiple browser processes with different profile directories

**"Browser is already running" Errors:**
- **Cause**: Attempted to launch second browser instance in same service
- **Architecture**: Resolved by dependency injection creating isolated instances per scraper

**Browser Process Management:**
```javascript
// Each scraper gets its own browser instance automatically
const scraperA = container.resolve('scraperApplication');  // Gets browser instance A
const scraperB = container.resolve('youtubeScraperService'); // Gets browser instance B
```

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

### Deployment Troubleshooting

#### Systemd Service Issues
**Node.js PATH Problems:**
- **Issue**: `/usr/bin/env: 'node': No such file or directory`
- **Cause**: Node.js not available in systemd service PATH
- **Solution**: Update service file with explicit Node.js path or use deployment script

**Browser Launch Failures:**
- **Issue**: `Missing X server or $DISPLAY` errors
- **Cause**: Browser requires display server for automation
- **Solution**: Use deployment script with Xvfb or set `DISPLAY=:99`

#### Manual Deployment (Development)
```bash
# Start with proper display environment
DISPLAY=:99 node index.js

# Or use deployment script
bash scripts/deployment/discord-bot-start.sh
```

#### Verification Commands
```bash
# Check browser processes are running with separate profiles
ps aux | grep chrome | grep profile

# Verify Xvfb virtual display
ps aux | grep Xvfb

# Check bot process
ps aux | grep "node index.js"
```

### Logging Infrastructure
- **File Logging**: Winston with daily rotation
- **Discord Logging**: Optional log mirroring to Discord channel
- **Log Levels**: error, warn, info, debug, verbose
- **Structured Logging**: JSON format with contextual metadata

### Common Operational Issues

#### Browser Connection Errors
**Symptoms**: `Browser connection lost` repeated in logs
**Diagnosis**: 
```bash
# Check if both browser instances are running
ps aux | grep chrome
# Should show 2 separate browser processes with different profile directories
```
**Resolution**: Restart with proper Xvfb environment

#### Scraper Conflicts
**Symptoms**: One scraper working but other failing
**Diagnosis**: Both scrapers should have separate browser profiles
**Resolution**: Verify dependency injection is creating isolated instances

---

*This compact guide covers essential development patterns. Reference the full CLAUDE.md for comprehensive details.*