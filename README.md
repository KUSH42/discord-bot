# Discord Content Announcement Bot

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/KUSH42/discord-bot/test.yml?branch=fix%2Fbugfix3&style=for-the-badge)
![Codecov (with branch)](https://img.shields.io/codecov/c/github/KUSH42/discord-bot/dev?style=for-the-badge&link=https%3A%2F%2Fapp.codecov.io%2Fgh%2FKUSH42%2Fdiscord-bot%2Ftree%2Ffix%2Fbugfix3%2F)
![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=for-the-badge)
![Discord.js](https://img.shields.io/badge/discord.js-v14-7289DA?style=for-the-badge)
![License](https://img.shields.io/github/license/KUSH42/discord-bot?style=for-the-badge)

A robust, production-ready Discord bot for real-time content announcements from
YouTube and X (formerly Twitter), built with Clean Architecture and a
comprehensive testing suite.

## Overview

This Node.js bot monitors designated YouTube channels and X profiles, delivering
real-time content announcements to your Discord channels. It is engineered for
reliability, security, and extensibility, featuring a sophisticated fallback
system for YouTube notifications, persistent duplicate detection, and secure
credential management.

The project is designed with a clear separation of concerns, making it easy for
developers (and AI agents) to maintain, test, and extend.

## Key Features

- **📺 Content Monitoring**
  - **Real-time YouTube Notifications**: Uses PubSubHubbub for instant upload
    and livestream announcements.
  - **Intelligent Fallback System**: Automatically switches to API polling if
    PubSubHubbub fails, ensuring no content is missed.
  - **YouTube Web Scraping**: Near-instantaneous content detection (15-second
    polling) using Playwright for backup monitoring.
  - **Multi-Source Detection with Priority**: Webhook notifications override API
    polling, which overrides scraper detection for optimal reliability.
  - **Livestream State Management**: Tracks scheduled → live → ended transitions
    with proper announcement timing.
  - **Enhanced Content Fingerprinting**: Advanced duplicate detection using
    title normalization and timestamp precision, preventing duplicates even with
    URL variations.
  - **Persistent Content State**: Content states survive bot restarts with
    file-based storage and automatic cleanup.
  - **Race Condition Prevention**: ContentCoordinator ensures same content from
    multiple sources doesn't cause duplicate announcements.
  - **X (Twitter) Scraping**: Monitors profiles for new posts, replies, quotes,
    and retweets with robust authentication recovery and health monitoring.
  - **Persistent Duplicate Detection**: Scans channel history on startup to
    prevent re-announcing content across restarts.
  - **Advanced Retweet Classification**: Uses multiple strategies to accurately
    identify and route retweets.

- **🛡️ Security & Reliability**
  - **Credential Encryption**: Securely stores API keys and passwords using
    `.envx` encryption.
  - **Webhook Signature Verification**: Cryptographically validates incoming
    YouTube notifications.
  - **Advanced Rate Limiting**: Modern event-driven Discord API rate limiting
    with burst allowances, 429 error handling, and exponential backoff.
  - **Event-Driven Message Processing**: Replaces infinite-loop architecture
    with EventEmitter patterns for better testing and reliability.
  - **Queue Management**: Priority-based message queue with deterministic test
    execution and graceful degradation.
  - **Configuration Validation**: Ensures all required configurations are
    present on startup.

- **🎭 Advanced Anti-Botting Resilience**
  - **Browser Stealth System**: State-of-the-art anti-detection capabilities
    with user agent rotation, fingerprint resistance, and automation marker removal.
  - **Human Behavior Simulation**: Realistic mouse movements, scrolling patterns,
    reading time estimation, and natural interaction timing.
  - **Intelligent Rate Limiting**: Context-aware timing optimized for 1-2 minute
    updates with time-of-day awareness and burst detection.
  - **Session Persistence**: Persistent browser profiles with cookie/localStorage
    management across bot restarts.
  - **Detection Monitoring**: Real-time incident tracking with automated response
    and pattern analysis.
  - **Performance Monitoring**: Resource usage tracking with optimization
    recommendations and performance grading.

- **🏗️ Architecture & Extensibility**
  - **Clean Architecture**: A modular design separating application, core logic,
    and infrastructure.
  - **Dependency Injection**: Manages services through a centralized container
    for easy mocking and maintenance.
  - **Event-Driven**: Decoupled components communicate via an event bus.

- **⚙️ Management & Monitoring**
  - **Discord Bot Commands**: Full control over the bot via chat commands.
  - **Enhanced Logging System**: Advanced logging with module-specific debug 
    controls, correlation tracking, and performance metrics.
  - **Runtime Debug Control**: Toggle debug logging per module without restarts
    using Discord commands.
  - **Performance Metrics**: Real-time collection and monitoring of system 
    performance with Discord integration.
  - **Health Check Endpoints**: HTTP endpoints for external monitoring
    (`/health`, `/ready`).
  - **Comprehensive Logging**: Rotates log files and can mirror logs to a
    Discord channel.

## Architecture

The bot follows clean architecture principles to ensure a clear separation of
concerns, high testability, and maintainability.

```bash
src/
├── 🎯 application/           # Application layer (orchestrators) - Comprehensive test coverage
│   ├── auth-manager.js       # X/Twitter authentication and session management (93.12% test coverage)
│   ├── bot-application.js    # Discord bot orchestrator and command processing (70.51% test coverage)
│   ├── monitor-application.js # YouTube monitoring and PubSubHubbub handling (95.84% test coverage)
│   └── scraper-application.js # X/Twitter content scraping orchestrator (70.06% test coverage)
├── 💼 core/                  # Business logic layer
│   ├── command-processor.js  # Discord command processing (89.47% test coverage)
│   ├── content-announcer.js  # Content announcement formatting and routing
│   ├── content-classifier.js # Content type classification and validation
│   ├── content-coordinator.js # Multi-source content coordination with race condition prevention (100% test coverage)
│   ├── content-state-manager.js # Unified content state management and persistence (100% test coverage)
│   └── livestream-state-machine.js # Livestream transition tracking (scheduled → live → ended) (95.37% test coverage)
├── 🏗️ infrastructure/        # Foundation layer
│   ├── configuration.js      # Environment configuration management
│   ├── debug-flag-manager.js # Module-specific debug controls with runtime toggling
│   ├── dependency-container.js # Dependency injection container
│   ├── event-bus.js          # Event-driven communication
│   ├── metrics-manager.js    # Performance metrics collection and aggregation
│   ├── persistent-storage.js # File-based content state and fingerprint storage
│   └── state-manager.js      # Runtime state management
├── 🔧 services/              # External service layer (e.g., Discord, YouTube clients)
│   ├── browser-stealth/      # Advanced anti-botting resilience system
│   │   ├── user-agent-manager.js      # Dynamic user agent rotation with platform matching
│   │   ├── human-behavior-simulator.js # Realistic interaction patterns (482 lines)
│   │   ├── intelligent-rate-limiter.js # Context-aware timing for 1-2 min updates
│   │   ├── browser-profile-manager.js  # Persistent browser profiles (442 lines)
│   │   ├── detection-monitor.js        # Real-time anti-bot incident tracking
│   │   ├── performance-monitor.js      # Resource usage monitoring & optimization
│   │   └── stealth-scripts.js         # JavaScript environment spoofing
│   ├── implementations/      # Service implementations
│   │   ├── enhanced-playwright-browser-service.js # Integrated stealth browser
│   │   └── stealth-browser-factory.js # Easy-to-use factory for stealth browsers
├── ⚙️ config/                # Configuration modules
│   └── content-detection.js  # Content detection reliability configuration
├── ⚙️ setup/                 # Production dependency wiring
└── 🛠️ utilities/             # Shared utilities
    ├── async-mutex.js        # Async operation synchronization
    ├── enhanced-logger.js    # Advanced logging with correlation tracking and metrics
    ├── time-parser.js        # Time parsing utilities
    └── utc-time.js          # Timezone-safe UTC time operations
```

## YouTube Content Detection Reliability

The bot features a sophisticated multi-layered system for reliable YouTube
content detection, designed to prevent missed content and eliminate duplicate
announcements.

### Content Detection Sources & Priority

The system uses **Source Priority** to handle the same content being detected by
multiple systems:

1. **🔗 Webhooks** (Highest Priority) - Real-time PubSubHubbub push
   notifications from YouTube
2. **📡 API Polling** (Medium Priority) - Direct YouTube Data API v3 queries
3. **🕷️ Web Scraping** (Lowest Priority) - Playwright-based fallback scraping

When the same video is detected by multiple sources, the higher priority source
wins, ensuring the most reliable data is used while preventing duplicate
announcements.

### Enhanced Content State Management

- **Unified State Tracking**: Single source of truth for all content states,
  replacing previous dual-logic inconsistencies
- **Persistent Storage**: Content states survive bot restarts with automatic
  cleanup of old entries
- **Livestream Transitions**: Proper tracking of
  `scheduled → live → ended → published` state changes with appropriate
  announcements

### Advanced Duplicate Detection

- **Content Fingerprinting**: Uses normalized titles and timestamp precision to
  detect duplicates even when URLs vary
- **URL Normalization**: Handles different YouTube URL formats (`youtu.be`,
  `youtube.com`, query parameters)
- **Cross-Restart Persistence**: Duplicate detection data survives bot restarts
- **Memory Management**: Automatic cleanup prevents memory bloat in long-running
  instances

### Race Condition Prevention

The **ContentCoordinator** prevents issues when multiple detection systems find
the same content simultaneously:

- **Processing Locks**: Ensures same content isn't processed multiple times
  concurrently
- **Source Coordination**: Manages conflicts between webhook, API, and scraper
  detections
- **Unified Processing**: Single pipeline for all content regardless of
  detection source

### Browser Automation Reliability

The bot uses **Playwright** for X and YouTube web scraping with comprehensive reliability improvements to prevent browser closure race conditions:

#### **Enhanced Browser State Validation**
- **Connection Health Checks**: Validates browser connectivity and page status before each operation
- **Graceful Error Handling**: Detects browser closure scenarios and provides clear error messages
- **State Recovery**: Automatically handles browser disconnections without crashing the scraper

#### **Operation Synchronization**
- **AsyncMutex Protection**: Custom mutex utility prevents concurrent browser operations that could cause race conditions
- **Sequential Processing**: Browser operations are queued and executed sequentially to prevent conflicts
- **Graceful Shutdown Coordination**: Waits for ongoing operations before browser cleanup during restarts

#### **Improved Retry Logic**
- **Smart Retry Strategy**: Distinguishes between retryable errors (network timeouts) and permanent failures (browser closure)
- **Safe Delay Handling**: Uses `setTimeout` instead of browser-dependent delays during retries
- **Error Classification**: Detects "Target page, context or browser has been closed" errors and handles them appropriately

### Configuration

All reliability features are configurable through environment variables (see
[Configuration](#-configuration) section):

- `MAX_CONTENT_AGE_HOURS=2` - Only announce content newer than 2 hours
- `ENABLE_CONTENT_FINGERPRINTING=true` - Enable advanced duplicate detection
- `ENABLE_LIVESTREAM_MONITORING=true` - Enable livestream state tracking
- `CONTENT_STORAGE_DIR=data` - Directory for persistent storage

## Advanced Anti-Botting Resilience System

The bot features a comprehensive, state-of-the-art anti-detection system designed to make browser automation indistinguishable from human behavior while maintaining timely content updates (1-2 minutes). This system was implemented based on the detailed analysis in `docs/ANTI-BOTTING-RESILIENCE-PLAN.md`.

### 🎭 Browser Stealth Capabilities

#### **Dynamic User Agent Management**
- **13+ Diverse Browser/Platform Combinations**: Chrome, Firefox, Edge across Windows, macOS, and Linux
- **Hourly Rotation**: Automatic user agent rotation with matching viewport dimensions
- **Platform-Specific Headers**: Appropriate Accept-Language and browser headers for each platform
- **Viewport Matching**: Screen resolutions that match the user agent platform for authenticity

#### **Advanced JavaScript Environment Spoofing**
- **Automation Marker Removal**: Removes 15+ automation detection indicators (`navigator.webdriver`, Chrome automation flags)
- **Plugin Array Spoofing**: Simulates realistic browser plugin configurations
- **Performance Timing Spoofing**: Generates realistic navigation timing data
- **Canvas/WebGL/Audio Fingerprint Resistance**: Anti-fingerprinting protection with controlled randomization

### 🧠 Human Behavior Simulation

#### **Realistic Interaction Patterns**
- **Mouse Movement Simulation**: Bezier curve trajectories with natural jitter and multi-step movements
- **Context-Aware Scrolling**: Reading time estimation based on content length (200 WPM simulation)
- **Natural Typing Patterns**: Variable delays with punctuation-aware timing and character-by-character input
- **Interactive Element Hovering**: Random element interaction with realistic hover durations

#### **Reading Behavior Simulation**
- **Content Analysis**: Estimates reading time based on visible text content
- **Comprehension Factors**: Adjusts reading speed based on content complexity
- **Natural Variance**: ±30% variation in reading patterns for human-like behavior

### ⏱️ Intelligent Rate Limiting (Optimized for 1-2 Minute Updates)

#### **Context-Aware Timing Patterns**
- **Active Session**: 1-minute base intervals during high activity periods
- **Idle Session**: 2-minute base intervals during low activity periods  
- **Night Mode**: 5-minute base intervals (2 AM - 6 AM) for reduced activity simulation
- **Weekend Mode**: 3-minute base intervals for weekend browsing patterns

#### **Smart Burst Detection & Penalties**
- **Burst Threshold**: Monitors request frequency over 5-minute windows
- **Progressive Penalties**: Up to 150% interval increase for suspicious activity patterns
- **Decay System**: Penalties automatically reduce over 30-minute periods
- **Emergency Mode**: Automatic 10-minute intervals during detection incidents

### 💾 Session Persistence & Profile Management

#### **Persistent Browser Profiles**
- **Purpose-Based Organization**: Separate profiles for different monitoring tasks (e.g., 'x-monitoring')
- **Cookie & localStorage Management**: Automatic session restoration across bot restarts
- **Profile Statistics**: Usage tracking and session count monitoring
- **Automatic Cleanup**: Configurable profile expiration (30 days default) with intelligent cleanup

#### **Session Continuity**
- **Restart Persistence**: Authentication states survive application restarts
- **Session Validation**: Health checks ensure session integrity before operations
- **Graceful Recovery**: Automatic session refresh when authentication expires

### 🔍 Real-Time Detection Monitoring

#### **Incident Classification & Tracking**
- **15+ Detection Signatures**: Identifies bot detection patterns in responses, errors, and HTTP status codes
- **Severity Scoring**: Critical/High/Medium/Low classification based on detection probability
- **Pattern Analysis**: Tracks detection trends and frequency over time
- **Incident History**: Maintains up to 1000 recent incidents with automatic cleanup

#### **Automated Response System**
- **Emergency Mode Activation**: Automatic rate limiting increase during detection spikes
- **User Agent Rotation**: Proactive rotation after critical detection incidents
- **Alert Thresholds**: Configurable incident count triggers (3 incidents/hour default)
- **Recommendation Engine**: Generates actionable optimization suggestions

### 📊 Performance Monitoring & Optimization

#### **Resource Usage Tracking**
- **Memory Monitoring**: Tracks heap usage with 1GB alert threshold
- **CPU Usage Analysis**: Monitors process CPU consumption with 80% alert threshold
- **Operation Timing**: Measures navigation, interaction, and scraping performance
- **Performance Grading**: A-F scoring system based on efficiency metrics

#### **Automatic Optimization**
- **Profile Cleanup Triggers**: Memory-based automatic profile maintenance
- **Performance Recommendations**: Automated suggestions for optimization
- **Resource Limit Enforcement**: Prevents runaway resource consumption
- **Health Check Integration**: Continuous monitoring with Discord command integration

### Configuration

The anti-botting system is fully configurable through environment variables:

```bash
# Browser Stealth Configuration
BROWSER_STEALTH_ENABLED=true
BEHAVIOR_SIMULATION_ENABLED=true
USER_AGENT_ROTATION_INTERVAL=3600000
INTELLIGENT_RATE_LIMITING=true
MIN_REQUEST_INTERVAL=30000
MAX_REQUEST_INTERVAL=300000

# Detection Monitoring
DETECTION_MONITORING_ENABLED=true
DETECTION_ALERT_THRESHOLD=3
DETECTION_MONITORING_WINDOW=3600000

# Performance Monitoring
PERFORMANCE_MONITORING_ENABLED=true
PERFORMANCE_MEMORY_THRESHOLD=1073741824
PERFORMANCE_CPU_THRESHOLD=80

# Browser Profile Management
BROWSER_PROFILE_PERSISTENCE=true
BROWSER_PROFILE_DIR=./browser-profiles
PROFILE_MAX_AGE_DAYS=30
```

### Usage Example

```javascript
import { StealthBrowserFactory } from './services/implementations/stealth-browser-factory.js';

const factory = new StealthBrowserFactory(config, logger);
const browser = await factory.createHighStealthBrowser({
  purpose: 'x-monitoring'
});

// Navigate with full anti-detection capabilities
await browser.goto('https://x.com/username');

// Monitor system status
const status = factory.getStatus();
console.log(`Detection incidents: ${status.detectionMonitor.metrics.detectionIncidents}`);
console.log(`Performance grade: ${status.performanceMonitor.grade}`);
```

## X (Twitter) Authentication Recovery & Health Monitoring

The bot features a robust authentication recovery system for X (Twitter) scraping, designed to handle temporary network issues, authentication failures, and browser crashes without manual intervention.

### Authentication Recovery Features

- **🔄 Smart Retry Logic**: Automatic retry with exponential backoff (3 attempts by default) for recoverable errors
- **🧠 Error Classification**: Distinguishes between temporary network issues and permanent credential problems
- **💾 Session Persistence**: Saves authentication cookies across restarts to minimize re-authentication
- **⚡ Intelligent Fallback**: Automatically switches from cookie-based to credential-based authentication when needed

### Health Monitoring System

- **🩺 Periodic Health Checks**: Monitors authentication status, browser health, and application state every 5 minutes
- **🚀 Automatic Recovery**: Detects failures and automatically attempts to restart the scraper component
- **📊 Comprehensive Status**: Tracks running status, authentication state, and browser connectivity
- **🔔 Event Notifications**: Emits events for external monitoring when recovery attempts fail

### Recovery Process Flow

1. **Authentication Failure Detection** → Classify error type (recoverable vs permanent)
2. **Smart Retry Strategy** → Exponential backoff for network/timeout issues
3. **Health Monitoring** → Continuous monitoring detects persistent failures
4. **Automatic Recovery** → Restart scraper component with fresh authentication
5. **Manual Intervention** → Discord commands available for admin control

### Granular Management Commands

The bot provides fine-grained control over the X scraper component without affecting YouTube monitoring:

- `!restart-scraper` - Restart only the X scraper with retry logic
- `!auth-status` - Check current authentication status
- `!scraper-health` - Detailed health diagnostics
- `!force-reauth` - Clear cookies and force fresh authentication

This system ensures maximum uptime and reduces the need for manual intervention when temporary issues occur.

## Getting Started (Quick Start)

Follow these steps to get the bot running quickly for local development.

1.  **Clone the repository:**

    ```sh
    git clone https://github.com/KUSH42/discord-youtube-bot.git
    cd discord-youtube-bot
    ```

2.  **Install dependencies:**

    ```sh
    npm install
    ```

3.  **Create a configuration file:**

    ```sh
    cp .env.example .env
    ```

4.  **Fill in the `.env` file** with your API keys and channel IDs. See the
    [Configuration](#-configuration) and
    [Detailed Setup](#-detailed-setup-guide) sections for more details.

5.  **Start the bot:**
    ```sh
    # For production with encrypted credentials (recommended)
    npm run decrypt
    
    # For development with unencrypted credentials
    npm start
    ```

## Detailed Setup Guide

### Prerequisites

- [Node.js](https://nodejs.org/) (v16.x or higher)
- A publicly accessible URL for YouTube's webhook (e.g., from a VPS or using
  [ngrok](https://ngrok.com/) for local testing).

### API Keys & Credentials

You'll need the following credentials:

- **Discord Bot Token**:
  1.  Go to the
      [Discord Developer Portal](https://discord.com/developers/applications)
      and create a new application.
  2.  Navigate to the "Bot" tab, click "Add Bot", and copy the **token**.
  3.  Enable the **Message Content Intent** under "Privileged Gateway Intents".
  4.  Generate an invite link from the "OAuth2" -> "URL Generator" tab with the
      `bot` scope and necessary permissions (e.g., `Send Messages`,
      `Read Message History`).
- **YouTube Data API Key**:
  1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
  2.  Create or select a project and enable the **YouTube Data API v3**.
  3.  Create an **API Key** from the "Credentials" page.
- **Discord Channel & User IDs**:
  1.  Enable Developer Mode in Discord (User Settings → Advanced).
  2.  Right-click on a channel or user and select "Copy ID".

### Secure Configuration (Recommended)

For production or secure environments, encrypt your credentials:

```sh
npm run setup-encryption
```

This interactive script will prompt you for sensitive values, encrypt them, and
generate a `.env.keys` file. **Do not commit `.env.keys` to version control.**
The bot will automatically decrypt the values at runtime when started with
`npm run decrypt`.

## Configuration

All configuration is managed through the `.env` file.

| Variable                           | Description                                                                | Required | Default               |
| ---------------------------------- | -------------------------------------------------------------------------- | -------- | --------------------- |
| `DISCORD_BOT_TOKEN`                | Your Discord bot's token.                                                  | **Yes**  |                       |
| `DISCORD_BOT_SUPPORT_LOG_CHANNEL`  | Channel ID for bot logs and health status commands.                        | **Yes**  |                       |
| `DISCORD_YOUTUBE_CHANNEL_ID`       | Channel ID for YouTube video announcements.                                | **Yes**  |                       |
| `DISCORD_X_POSTS_CHANNEL_ID`       | Channel ID for X (Twitter) post announcements.                             | **Yes**  |                       |
| `DISCORD_X_REPLIES_CHANNEL_ID`     | Channel ID for X reply announcements.                                      | No       |                       |
| `DISCORD_X_QUOTES_CHANNEL_ID`      | Channel ID for X quote announcements.                                      | No       |                       |
| `DISCORD_X_RETWEETS_CHANNEL_ID`    | Channel ID for X retweet announcements.                                    | No       |                       |
| `YOUTUBE_API_KEY`                  | Your Google Cloud YouTube Data API v3 key.                                 | **Yes**  |                       |
| `YOUTUBE_CHANNEL_ID`               | The ID of the YouTube channel to monitor.                                  | **Yes**  |                       |
| `PSH_SECRET`                       | A strong, secret string for verifying PubSubHubbub webhooks.               | **Yes**  |                       |
| `PSH_CALLBACK_URL`                 | The public URL of your bot's webhook endpoint.                             | **Yes**  |                       |
| `PSH_PORT`                         | The port for the webhook server to listen on.                              | No       | `3000`                |
| `X_USER_HANDLE`                    | The handle of the X user to monitor.                                       | **Yes**  |                       |
| `TWITTER_USERNAME`                 | The username of the X account used for scraping.                           | **Yes**  |                       |
| `TWITTER_PASSWORD`                 | The password for the scraping account.                                     | **Yes**  |                       |
| `ALLOWED_USER_IDS`                 | Comma-separated list of Discord user IDs authorized for admin commands.    | **Yes**  |                       |
| `COMMAND_PREFIX`                   | The prefix for bot commands.                                               | No       | `!`                   |
| `LOG_LEVEL`                        | Logging level (`info`, `debug`, `warn`, `error`).                          | No       | `info`                |
| `LOG_FILE_PATH`                    | Path to the log file.                                                      | No       | `bot.log`             |
| `ANNOUNCEMENT_ENABLED`             | Master toggle for all announcements.                                       | No       | `false`               |
| `X_VX_TWITTER_CONVERSION`          | Automatically convert `twitter.com` links to `vxtwitter.com`.              | No       | `false`               |
| `WEBHOOK_DEBUG_LOGGING`            | Enable detailed webhook debugging logs for PubSubHubbub troubleshooting.   | No       | `false`               |
| `SYSTEMD_SERVICE_NAME`             | The name of the `systemd` service for the `!update` command.               | No       | `discord-bot.service` |
| `YOUTUBE_SCRAPER_INTERVAL_MS`      | YouTube web scraper polling interval in milliseconds.                      | No       | `15000` (15 sec)      |
| `YOUTUBE_SCRAPER_MAX_RETRIES`      | Maximum retry attempts for YouTube scraper failures.                       | No       | `3`                   |
| `YOUTUBE_SCRAPER_TIMEOUT_MS`       | Timeout for YouTube scraper page operations in milliseconds.               | No       | `30000` (30 sec)      |
| `X_DEBUG_SAMPLING_RATE`            | Sampling rate for debug logs to reduce Discord spam (0.0-1.0).             | No       | `0.1` (10%)           |
| `X_VERBOSE_LOG_SAMPLING_RATE`      | Sampling rate for verbose logs to reduce Discord spam (0.0-1.0).           | No       | `0.05` (5%)           |
| `DISCORD_BASE_SEND_DELAY`          | Base delay between Discord message sends in milliseconds.                  | No       | `2000` (2 sec)        |
| `DISCORD_BURST_ALLOWANCE`          | Number of quick Discord messages allowed per burst period.                 | No       | `2`                   |
| `DISCORD_MAX_BUFFER_SIZE`          | Maximum Discord log message buffer size before flushing.                   | No       | `30`                  |
| **Content Detection Reliability**  |                                                                            |          |                       |
| `MAX_CONTENT_AGE_HOURS`            | Maximum age in hours for content to be considered "new" and announced.     | No       | `2`                   |
| `ENABLE_CONTENT_FINGERPRINTING`    | Enable enhanced duplicate detection using content fingerprinting.          | No       | `true`                |
| `ENABLE_LIVESTREAM_MONITORING`     | Enable scheduled livestream state monitoring and transitions.              | No       | `true`                |
| `ENABLE_CROSS_VALIDATION`          | Enable cross-system content validation between detection sources.          | No       | `true`                |
| `CONTENT_STORAGE_DIR`              | Directory for persistent content state storage.                            | No       | `data`                |
| `DUPLICATE_CLEANUP_INTERVAL_HOURS` | Hours between duplicate detection cleanup operations.                      | No       | `168` (1 week)        |
| `LIVESTREAM_POLLING_INTERVAL_MS`   | Interval in milliseconds for polling scheduled livestream state changes.   | No       | `30000` (30 sec)      |
| `WEBHOOK_MAX_RETRIES`              | Maximum retry attempts for failed webhook processing.                      | No       | `3`                   |
| `PROCESSING_LOCK_TIMEOUT_MS`       | Timeout in milliseconds for content processing locks to prevent deadlocks. | No       | `30000` (30 sec)      |

## Usage

### Running the Bot

- **Standard start**: Validates configuration and starts the bot (for development).
  ```sh
  npm start
  ```
- **Start with encrypted credentials** (recommended for production):
  ```sh
  npm run decrypt
  ```

### Bot Commands

Commands are used in the channel specified by `DISCORD_BOT_SUPPORT_LOG_CHANNEL`.

#### General Commands

| Command                   | Description                                                        | Authorization |
| ------------------------- | ------------------------------------------------------------------ | ------------- |
| `!health`                 | Shows a summary of the bot's health and status.                    | Anyone        |
| `!health-detailed`        | Shows a detailed breakdown of each component's status.             | Anyone        |
| `!youtube-health`         | Shows detailed YouTube monitor health status with metrics embed.   | Anyone        |
| `!x-health`               | Shows detailed X scraper health status with metrics embed.         | Anyone        |
| `!announce <true/false>`  | Toggles all content announcements on or off.                       | Anyone        |
| `!vxtwitter <true/false>` | Toggles automatic `twitter.com` to `vxtwitter.com` URL conversion. | Anyone        |
| `!loglevel <level>`       | Changes the logging level (`info`, `debug`, `warn`, `error`).      | Anyone        |
| `!debug <module> <true/false>` | Toggles debug logging for specific modules without restart.    | Anyone        |
| `!debug-status`           | Shows current debug status and levels for all modules.             | Anyone        |
| `!debug-level <module> <1-5>` | Sets debug level for a module (1=errors, 5=verbose).          | Anyone        |
| `!metrics`                | Shows performance metrics and system statistics.                   | Anyone        |
| `!log-pipeline`           | Shows recent pipeline activities with correlation tracking.         | Anyone        |
| `!auth-status`            | Shows X (Twitter) authentication status.                           | Anyone        |
| `!scraper-health`         | Shows detailed X scraper health status.                            | Anyone        |
| `!readme`                 | Displays a summary of available commands.                          | Anyone        |

#### Administrative Commands

| Command            | Description                                                                     | Authorization    |
| ------------------ | ------------------------------------------------------------------------------- | ---------------- |
| `!restart`         | Restarts the entire bot process, reloading all configurations.                  | Authorized Users |
| `!update`          | Pulls the latest changes from git, installs dependencies, and restarts.         | Authorized Users |
| `!kill`            | Immediately stops all announcement-posting activities.                          | Authorized Users |
| `!restart-scraper` | Restarts only the X scraper application with automatic retry logic.             | Authorized Users |
| `!stop-scraper`    | Stops the X scraper application (YouTube monitoring continues).                 | Authorized Users |
| `!start-scraper`   | Starts the X scraper application.                                               | Authorized Users |
| `!force-reauth`    | Forces re-authentication with X, clearing saved cookies and restarting scraper. | Authorized Users |

## Enhanced Logging System

The bot features a comprehensive enhanced logging system that provides granular debug control, performance monitoring, and operation correlation tracking.

### Features

- **🔧 Module-Specific Debug Control**: Toggle debug logging for individual modules (content-announcer, scraper, youtube, browser, auth, performance, api, state, rate-limiting) without restarting the bot
- **📊 Real-Time Performance Metrics**: Automatic collection of timing, counter, and gauge metrics with percentile calculations
- **🔗 Correlation Tracking**: Automatic correlation ID generation for tracking operations across modules
- **⚡ Runtime Configuration**: All debug settings persist across restarts and can be changed via Discord commands
- **🛡️ Security**: Automatic sanitization of sensitive data in log outputs
- **📈 Discord Integration**: Monitor system performance and debug status directly through Discord commands

### Debug Modules

| Module | Description |
|--------|-------------|
| `content-announcer` | Content announcement pipeline and message formatting |
| `scraper` | X (Twitter) scraping operations and browser interactions |
| `youtube` | YouTube monitoring, webhook processing, and API calls |
| `browser` | Browser automation, stealth operations, and anti-detection |
| `auth` | Authentication flows and session management |
| `performance` | Performance metrics and timing measurements |
| `api` | External API calls (YouTube Data API, Discord API) |
| `state` | State management operations and persistence |
| `rate-limiting` | Rate limiting and throttling operations |

### Debug Levels

| Level | Name | Description |
|-------|------|-------------|
| 1 | errors | Error messages only |
| 2 | warnings | Warnings and errors |
| 3 | info | Informational messages, warnings, and errors (default) |
| 4 | debug | Debug information plus all above |
| 5 | verbose | Verbose/trace level logging plus all above |

### Usage Examples

```bash
# Enable debug logging for content announcer
!debug content-announcer true

# Set verbose logging for browser operations
!debug-level browser 5

# Check current debug status
!debug-status

# View performance metrics
!metrics

# Monitor recent operations
!log-pipeline
```

### Environment Configuration

You can set initial debug flags and levels via environment variables:

```bash
# Enable specific modules by default
DEBUG_FLAGS=content-announcer,scraper,performance

# Set specific debug levels
DEBUG_LEVEL_SCRAPER=5
DEBUG_LEVEL_BROWSER=1
```

### Integration Benefits

- **Faster Debugging**: Instantly enable detailed logging for specific components without restarts
- **Performance Insights**: Real-time metrics help identify bottlenecks and optimization opportunities
- **Operational Visibility**: Discord commands provide immediate access to system status and health
- **Correlation Tracking**: Follow operations across modules using correlation IDs for complex debugging scenarios

## Deployment (Production)

For production, it is recommended to run the bot as a `systemd` service for
automatic restarts and process management.

1.  **Create a service file** at `/etc/systemd/system/discord-bot.service`:

    ```ini
    [Unit]
    Description=Discord Content Announcement Bot
    After=network.target

    [Service]
    Type=simple
    # Replace 'your_bot_user' with the user the bot runs as
    User=your_bot_user
    # The start-bot.sh script handles finding the correct Node.js path
    ExecStart=/home/your_bot_user/discord-youtube-bot/scripts/start-bot.sh
    Restart=on-failure
    RestartSec=10s
    StandardOutput=syslog
    StandardError=syslog

    [Install]
    WantedBy=multi-user.target
    ```

2.  **Enable and start the service:**

    ```sh
    sudo systemctl daemon-reload
    sudo systemctl enable discord-bot.service
    sudo systemctl start discord-bot.service
    ```

3.  **Sudo Permissions for `!update` command (Optional):** To allow the
    `!update` command to restart the service, grant the bot's user passwordless
    `sudo` access. Run `sudo visudo` and add this line, replacing
    `your_bot_user` and the service name:
    ```
    your_bot_user ALL=(ALL) NOPASSWD: /bin/systemctl restart discord-bot.service
    ```

### Docker Deployment

The bot includes optimized Docker support with multi-stage builds for both
development and production environments.

#### Quick Start with Docker

1. **Build and run the production image:**

   ```sh
   docker build -t discord-youtube-bot --target production .
   docker run -d --name bot --env-file .env -p 3000:3000 discord-youtube-bot
   ```

2. **Using Docker Compose (recommended):**
   ```yaml
   # docker-compose.yml
   version: '3.8'
   services:
     discord-bot:
       build:
         context: .
         target: production
       env_file: .env
       ports:
         - '3000:3000'
       restart: unless-stopped
       healthcheck:
         test: ['CMD', 'node', '-e', "console.log('Health check passed')"]
         interval: 30s
         timeout: 10s
         retries: 3
   ```

#### Docker Image Optimization

The Docker setup uses a **3-stage multi-stage build** for optimal performance:

- **`dependencies`**: Production dependencies only (~100MB)
- **`test-runner`**: Full test environment with Playwright (~600MB)
- **`production`**: Minimal runtime image (~200MB)

**Performance Benefits:**

- **Build Speed**: 90% faster builds with layer caching
- **Image Size**: 70% smaller production images
- **Security**: Non-root user, minimal attack surface
- **CI/CD**: Intelligent caching reduces bandwidth by 95%

#### Docker Build Targets

```sh
# Production runtime (default)
docker build -t bot:prod --target production .

# Development with tests
docker build -t bot:test --target test-runner .

# Dependencies only
docker build -t bot:deps --target dependencies .
```

## Testing & Quality Assurance

This project is committed to high quality through a comprehensive and automated
testing strategy. We maintain a suite of over 1.700 tests in more than 80 test 
suites, including unit, integration, end-to-end (E2E), performance, and 
security tests

Our testing philosophy emphasizes fast feedback, high confidence in critical
paths, and maintainability. All tests are executed automatically on every push
and pull request via GitHub Actions.

**Recent Testing Enhancements:**

- **Application Layer Coverage**: Achieved strong test coverage for all
  application orchestrators:
  - **bot-application.js**: 82.74% statement coverage with comprehensive command
    processing tests
  - **monitor-application.js**: 96.97% statement coverage with full PubSubHubbub,
    video processing, and scheduled content polling tests  
  - **scraper-application.js**: 77.57% statement coverage with authentication,
    content detection, and tweet processing tests
- **Critical Component Coverage**: Achieved 95%+ test coverage for core content
  pipeline components (LivestreamStateMachine, ContentCoordinator,
  ContentStateManager)
- **Event-Driven Architecture**: Modern testing patterns for EventEmitter-based
  message processing with comprehensive MessageQueue, RateLimiter, and
  ProcessingScheduler tests
- **Deterministic Test Execution**: Eliminated hanging tests with proper async
  timer handling and test mode support
- **Clean Test Output**: Implemented global console mocking to eliminate false
  positive error logs during test execution
- **Rate Limiting Testing**: Comprehensive tests for burst allowances, 429
  handling, and exponential backoff
- **Message Queue Testing**: Priority-based queuing, processing lifecycle, and
  graceful shutdown testing
- **Enhanced Duplicate Detection**: Comprehensive tests for content
  fingerprinting, URL normalization, and cross-restart persistence
- **Content State Management**: Tests for unified state tracking, livestream
  transitions, and persistent storage
- **Race Condition Prevention**: Tests for ContentCoordinator's processing locks
  and source priority handling
- **YouTube Monitoring Suite**: Complete test coverage for PubSubHubbub webhooks,
  signature verification, scheduled content polling, and live state transitions
- **Authentication & Security**: Comprehensive auth-manager tests covering
  X/Twitter authentication flows, session management, and credential handling
- **Comprehensive Command Testing**: Complete workflow tests for all Discord bot
  commands (!health, !announce, !restart, etc.)
- **YouTube Content Monitoring**: End-to-end tests for the complete YouTube
  announcement pipeline
- **Fallback Recovery**: Tests for YouTube API failure scenarios and recovery
  mechanisms
- **Browser Automation Reliability**: Tests for AsyncMutex operation synchronization, 
  browser state validation, and race condition prevention in Playwright operations

- **Run all tests locally:**
  ```sh
  npm test
  ```
- **Generate a coverage report:**
  ```sh
  npm run test:coverage
  ```

> For a complete guide to our testing architecture, CI/CD pipeline, code
> conventions, and instructions for contributing tests, please see the
> **[Testing README](./tests/README.md)**.

## Monitoring & Health

- **HTTP Endpoints**:
  - `GET /health`: Basic health status.
  - `GET /health/detailed`: Detailed status of all internal components.
  - `GET /ready`: Kubernetes-style readiness probe.
- **Discord Commands**: Use `!health` and `!health-detailed` for real-time
  status updates in Discord.
- **Component-Specific Health Commands**:
  - `!youtube-health`: Detailed YouTube monitor status with subscription info, processing stats, and error metrics in a rich embed format.
  - `!x-health`: Detailed X scraper status with authentication status, polling intervals, execution statistics, and content metrics in a rich embed format.

## Troubleshooting

- **`listen EADDRINUSE` Error**: The `PSH_PORT` is already in use by another
  application. Change the port or stop the conflicting process.
- **No YouTube Announcements**: Ensure `PSH_CALLBACK_URL` is public and
  reachable. Verify your API key and check bot logs for any subscription errors.
  Enable `WEBHOOK_DEBUG_LOGGING=true` for detailed webhook diagnostics.
- **Duplicate Announcements**: The enhanced duplicate detection should prevent
  this, but if it occurs, check the `data/` directory for proper content state
  persistence and verify `ENABLE_CONTENT_FINGERPRINTING=true`.
- **Missing Livestream Transitions**: Ensure `ENABLE_LIVESTREAM_MONITORING=true`
  and check logs for livestream state polling activity. Verify
  `LIVESTREAM_POLLING_INTERVAL_MS` is appropriate for your needs.
- **Content Too Old Errors**: Adjust `MAX_CONTENT_AGE_HOURS` if legitimate
  content is being rejected as too old. The default is 2 hours.
- **Storage Issues**: If the bot can't write to the storage directory, ensure
  the `CONTENT_STORAGE_DIR` path is writable and has sufficient disk space.
- **X Authentication Failures**: The bot uses cookie-based authentication detection for reliability. Check `!auth-status` and `!scraper-health` commands for diagnostics. The bot looks for `auth_token` and `ct0` cookies to verify login status. Use `!force-reauth` to clear cached credentials and retry authentication. For persistent issues, verify credentials are correct and the account isn't locked. Authentication failures are often caused by browser configuration triggering anti-bot detection (see Browser Issues below).
- **X Scraper Not Running**: Use `!scraper-health` to check status. The health monitoring system will attempt automatic recovery every 5 minutes. Manual recovery options: `!restart-scraper` (restart with retry logic) or `!start-scraper` if stopped.
- **Browser Anti-Bot Detection Issues**: If authentication succeeds but the bot reports failure, aggressive browser optimization flags may be triggering detection. The bot uses a carefully tuned browser configuration with only essential optimizations (`--disable-images`, `--disable-plugins`, `--mute-audio`) while avoiding detection-triggering flags like `--disable-web-security`. Both X and YouTube scrapers use `headless: false` with Xvfb virtual display. See `CLAUDE.md` for the complete safe browser configuration.
- **"Target page, context or browser has been closed" Errors**: These browser closure race conditions have been resolved through comprehensive fixes including AsyncMutex operation synchronization, enhanced browser state validation, and graceful shutdown coordination. The bot now properly handles concurrent browser operations and validates browser health before each action.
- **Startup Status Accuracy**: The bot now provides accurate startup messages. ✅ "Bot startup completed successfully" appears only when all components start without errors. ⚠️ "Bot startup completed with some components disabled due to errors" indicates one or more components failed to start, but core functionality remains operational.
- **Commands Not Working**: Confirm you are using the correct `COMMAND_PREFIX`
  in the designated support channel. Ensure your user ID is in
  `ALLOWED_USER_IDS` for admin commands. New scraper management commands are also admin-restricted.
- **Webhook Issues**: Set `WEBHOOK_DEBUG_LOGGING=true` in your `.env` file to
  get comprehensive debugging information about PubSubHubbub webhooks, including
  request details, signature verification, and processing flow.

## Development & Code Quality

This project maintains high code quality standards through automated tooling and
comprehensive testing:

### Code Quality Tools

- **ESLint**: Modern flat configuration with comprehensive rules for code
  quality, security, and performance
- **Prettier**: Consistent code formatting with file-specific rules for `.js`,
  `.md`, `.json`, and `.yml` files
- **Babel**: Modern JavaScript transpilation with Node.js 18+ targeting and
  polyfill management
- **Husky**: Pre-commit hooks for automated code quality checks

### Development Commands

```bash
# Code quality
npm run lint              # Run ESLint checks
npm run lint:fix          # Auto-fix ESLint issues
npm run format            # Check Prettier formatting

# Development workflow
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Generate detailed coverage reports
```

### Pre-commit Workflow

The project uses automated pre-commit hooks that:

1. Run ESLint with auto-fix for code quality
2. Apply Prettier formatting consistently
3. Validate environment configuration
4. Increment build numbers automatically
5. Run syntax validation

All commits automatically trigger these quality checks to maintain code
standards.

## Contributing

Contributions are welcome! Please follow this process:

1. **Fork the repository** and create a feature branch
2. **Make your changes** following the established patterns in the codebase
3. **Run quality checks**: `npm run lint:fix && npm run format`
4. **Add tests** for new functionality (see [Testing README](./tests/README.md))
5. **Commit your changes** - pre-commit hooks will run automatically
6. **Submit a pull request** with a clear description of your changes

The automated CI/CD pipeline will validate your changes across multiple Node.js
versions with comprehensive testing.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE)
file for details.
