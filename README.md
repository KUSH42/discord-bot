# 🤖 Discord Content Announcement Bot

![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Discord.js](https://img.shields.io/badge/discord.js-v14-7289da)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20windows%20%7C%20macos-lightgrey)

![Tests](https://github.com/KUSH42/discord-bot/workflows/Comprehensive%20Test%20Suite/badge.svg)
![Security](https://img.shields.io/badge/security-scanned-green)
![Performance](https://img.shields.io/badge/performance-monitored-blue)

> 🚀 **A production-ready Discord bot that automatically announces new content from YouTube channels and X (Twitter) profiles to your Discord server.**

This Node.js bot monitors designated YouTube channels and X profiles, delivering real-time content announcements to your Discord channels. Built with modern clean architecture, comprehensive testing infrastructure, enterprise-grade security, and production reliability features.

## 📋 Table of Contents

- [✨ Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [🔧 Quick Start](#-quick-start)
- [📋 Prerequisites](#-prerequisites)
- [🛠️ Setup Instructions](#️-setup-instructions)
- [⚙️ Configuration](#️-configuration)
- [🎮 Bot Commands](#-bot-commands)
- [📊 Monitoring & Health](#-monitoring--health)
- [🔒 Security Features](#-security-features)
- [🚀 Deployment](#-deployment)
- [🔍 How It Works](#-how-it-works)
- [🧪 Testing Infrastructure](#-testing-infrastructure)
- [🛡️ Development & Security](#️-development--security)
- [❓ Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)

## ✨ Features

### 🏗️ Modern Architecture
- **Clean Architecture:** Organized into layers (Application, Core, Infrastructure, Services)
- **Dependency Injection:** Centralized service management with IoC container
- **Service Interfaces:** Contract-based design for maintainability and testing
- **Event-Driven:** Decoupled components communicating through event bus
- **Modular Design:** Easily extensible and testable component structure

## 🏗️ Architecture

The bot follows clean architecture principles with clear separation of concerns and dependency injection:

```bash
src/
├── 🎯 application/           # Application layer
│   ├── auth-manager.js      # Authentication & session management
│   ├── bot-application.js     # Main bot orchestration
│   ├── monitor-application.js # YouTube monitoring app
│   └── scraper-application.js # X/Twitter scraping coordination
├── 💼 core/                  # Business logic layer
│   ├── command-processor.js   # Discord command handling
│   ├── content-announcer.js   # Content posting logic
│   └── content-classifier.js  # Content categorization
├── 🏗️ infrastructure/        # Foundation layer
│   ├── configuration.js       # Config management
│   ├── dependency-container.js # IoC container
│   ├── event-bus.js          # Event system
│   └── state-manager.js      # State management
├── 🔧 services/              # External service layer
│   ├── interfaces/           # Service contracts
│   └── implementations/      # Concrete implementations
├── ⚙️ setup/                 # Production setup
│   └── production-setup.js   # Dependency wiring
└── 🛠️ utilities/             # Shared utilities
    ├── config-validator.js   # Environment validation
    ├── discord-utils.js      # Discord helpers
    ├── duplicate-detector.js # Content deduplication
    ├── logger-utils.js       # Logging infrastructure
    └── rate-limiter.js       # Rate limiting
```

### Key Architectural Benefits
- **🧪 Testability:** ~70% source code coverage with isolated, mockable components
- **🔧 Maintainability:** Clear separation of concerns and single responsibility
- **🚀 Extensibility:** Easy to add new content sources or announcement targets
- **🛡️ Reliability:** Robust error handling and fallback mechanisms
- **📊 Observability:** Comprehensive logging and monitoring throughout

### 📺 Content Monitoring
- **YouTube Activity Monitoring:** Real-time notifications via PubSubHubbub for uploads and livestreams
- **YouTube Notification Fallback:** Intelligent retry system with API polling backup when PubSubHubbub fails
- **X (Twitter) Activity Monitoring:** Automated scraping for posts, replies, quotes, and retweets
- **Enhanced Retweet Detection:** Advanced multi-strategy retweet identification using author comparison, social context, and classic RT@ patterns
- **Smart Content Filtering:** Only announces content created *after* bot startup
- **Persistent Duplicate Detection:** Scans Discord channel history to prevent re-announcing content across bot restarts
- **Multi-Channel Support:** Different Discord channels for different content types (including dedicated retweet channels)

### 🔐 Security & Reliability
- **Credential Encryption:** Secure storage using dotenvx encryption
- **Rate Limiting:** Built-in protection for commands and webhooks
- **Configuration Validation:** Comprehensive startup validation
- **Webhook Signature Verification:** Cryptographic verification of incoming notifications
- **Memory Management:** Automatic cleanup to prevent memory leaks

### 🎛️ Management & Monitoring
- **Discord Commands:** Full bot control via Discord chat commands
- **Health Monitoring:** HTTP endpoints and Discord-based status commands
- **Comprehensive Logging:** File rotation, Discord mirroring, multiple log levels
- **Pre-commit Hooks:** Automated security and syntax validation
- **Auto-Recovery:** Handles failures with graceful degradation

### 🚀 Production Features
- **PubSubHubbub Integration:** Efficient real-time YouTube notifications with fallback protection
- **Intelligent Error Recovery:** Automatic retry with exponential backoff and API polling backup
- **Subscription Auto-Renewal:** Automated maintenance of YouTube subscriptions
- **Modular Architecture:** Clean architecture with dependency injection and service separation
- **Comprehensive Testing:** High code coverage with comprehensive tests across unit, integration, E2E, performance, and security, including a new integration test for production setup.
- **Systemd Support:** Production deployment with service management
- **Generic Deployment:** No hardcoded usernames or paths

## 🔧 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/KUSH42/discord-bot.git
cd discord-bot
npm install

# 2. Set up encrypted credentials (recommended)
npm run setup-encryption

# 3. Configure your .env file with API keys and channel IDs
# (See Configuration section below)

# 4. Start the bot
npm start
```

## 📋 Prerequisites

Before setting up the bot, ensure you have:

- 🟢 **Node.js (v16.x or higher)** - [Download here](https://nodejs.org/)
- 📦 **npm** (comes with Node.js)
- 🎮 **Discord Account** - For bot creation and management
- ☁️ **Google Cloud Project** - For YouTube Data API v3 access
- 🌐 **Publicly Accessible URL** - For YouTube webhook notifications (VPS, cloud hosting, or ngrok for local development)

## 🛠️ Setup Instructions

### 1️⃣ Project Initialization

```bash
# Clone the repository
git clone https://github.com/KUSH42/discord-bot.git
cd discord-bot

# Install dependencies
npm install
```

### 2️⃣ Secure Credential Setup

For enhanced security, use encrypted credential storage:

```bash
# Interactive encryption setup
npm run setup-encryption
```

**This script will:**
- 📝 Create a `.env` file template
- 🔐 Encrypt sensitive credentials (Twitter, Discord token, API keys)
- 🔑 Generate encryption keys in `.env.keys`

**⚠️ Security Notes:**
- Keep `.env.keys` secure and separate from your codebase
- Never commit `.env.keys` to version control
- The bot automatically decrypts credentials at runtime

### 3️⃣ API Keys and IDs

#### 🎮 Discord Bot Token

1. Visit the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a "New Application" and name it
3. Go to "Bot" tab → "Add Bot"
4. Copy the **TOKEN** (keep it secret!)
5. Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
6. Generate invite URL in "OAuth2" → "URL Generator" with bot scope and required permissions

#### 📺 YouTube Data API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable "YouTube Data API v3" in APIs & Services
4. Create credentials → API Key
5. Copy the generated key

#### 🆔 Channel IDs

**Discord Channels:**
1. Enable Developer Mode in Discord (User Settings → Advanced)
2. Right-click channels → "Copy ID"

**YouTube Channel:**
- From URL: `youtube.com/channel/YOUR_CHANNEL_ID`
- Or view page source and search for `channelId`

## ⚙️ Configuration

Create `.env` file with your configuration:

```env
# Discord Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_BOT_SUPPORT_LOG_CHANNEL=support_channel_id_here
DISCORD_YOUTUBE_CHANNEL_ID=youtube_announcements_channel_id
DISCORD_X_POSTS_CHANNEL_ID=x_posts_channel_id
DISCORD_X_REPLIES_CHANNEL_ID=x_replies_channel_id
DISCORD_X_QUOTES_CHANNEL_ID=x_quotes_channel_id
DISCORD_X_RETWEETS_CHANNEL_ID=x_retweets_channel_id  # Optional: dedicated retweet announcements

# YouTube Configuration
YOUTUBE_API_KEY=your_youtube_api_key_here
YOUTUBE_CHANNEL_ID=your_youtube_channel_id_here

# PubSubHubbub Configuration
PSH_SECRET=your_super_secret_string_for_webhook_verification
PSH_CALLBACK_URL=https://your-domain.com/webhook/youtube
PSH_PORT=3000
PSH_VERIFY_TOKEN=your_optional_verify_token

# X (Twitter) Configuration
X_USER_HANDLE=target_x_username
TWITTER_USERNAME=your_twitter_username
TWITTER_EMAIL=your_twitter_email
TWITTER_PASSWORD=your_twitter_password
X_QUERY_INTERVALL_MIN=300000
X_QUERY_INTERVALL_MAX=600000
ANNOUNCE_OLD_TWEETS=false

# YouTube Fallback System
YOUTUBE_FALLBACK_ENABLED=true
YOUTUBE_FALLBACK_DELAY_MS=15000
YOUTUBE_FALLBACK_MAX_RETRIES=3
YOUTUBE_API_POLL_INTERVAL_MS=300000
YOUTUBE_FALLBACK_BACKFILL_HOURS=2

# Bot Control
COMMAND_PREFIX=!
ALLOWED_USER_IDS=user_id_1,user_id_2
ANNOUNCEMENT_ENABLED=false
X_VX_TWITTER_CONVERSION=false
LOG_FILE_PATH=bot.log
LOG_LEVEL=info
SYSTEMD_SERVICE_NAME=discord-bot.service
```

## 🎮 Bot Commands

All commands work in the configured support channel with your chosen prefix (default `!`):

| Command | Description | Authorization |
|---------|-------------|--------------|
| `!kill` | 🛑 Stop all Discord posting | Authorized users only |
| `!restart` | 🔄 Performs a full restart of the bot, reloading the .env file and all configurations. | Authorized users only |
| `!announce <true\|false>` | 📢 Toggle announcement posting | Anyone |
| `!vxtwitter <true\|false>` | 🐦 Toggle URL conversion | Anyone |
| `!loglevel <level>` | 📝 Change logging level | Anyone |
| `!health` | 🏥 Show bot health status | Anyone |
| `!health-detailed` | 📊 Show detailed component health | Anyone |
| `!update` | 🚀 Pulls latest changes, updates dependencies, and restarts the bot | Authorized users only |
| `!readme` | 📖 Display command help | Anyone |

## 📊 Monitoring & Health

### HTTP Health Endpoints
- `GET /health` - 🏥 Basic health status (JSON)
- `GET /health/detailed` - 📊 Detailed component status
- `GET /ready` - ✅ Kubernetes-style readiness probe

### Discord Health Monitoring
- `!health` command shows rich embed with:
  - 🤖 Discord connection status
  - ⏱️ System uptime
  - 💾 Memory usage
  - 📡 Bot configuration status
  - 🛡️ YouTube fallback system status and metrics

### Rate Limiting Protection
- 👤 **Commands:** 5 per minute per user
- 🌐 **Webhooks:** 100 requests per 15 minutes per IP

## 🔒 Security Features

- 🔐 **Credential Encryption** with dotenvx
- 🛡️ **Webhook Signature Verification** using HMAC-SHA1
- ⚡ **Rate Limiting** for abuse prevention
- ✅ **Input Validation** and sanitization
- 🔍 **Pre-commit Security Scanning**
- 🛡️ **XXE Attack Prevention** in XML parsing
- ⏱️ **Timing-Safe Comparisons** for crypto operations

## 🚀 Deployment

### Development
```bash
npm start                   # 🟢 Normal start with validation
npm run decrypt             # 🔓 Start with explicit decryption
npm run validate            # ✅ Validate configuration only
```

### Sudo Permissions for !update

The `!update` command requires the bot's user to have passwordless `sudo` access to restart the systemd service. To set this up, run `sudo visudo` and add the following line, replacing `your_bot_user` with the actual username the bot runs under:

```bash
your_bot_user ALL=(ALL) NOPASSWD: /bin/systemctl restart your_service_name.service
```

Replace `your_service_name.service` with the name of your bot's systemd service, which should also be configured in your `.env` file as `SYSTEMD_SERVICE_NAME`.

### Production (systemd)

1. **Create service file** (`/etc/systemd/system/discord-bot.service`):
```ini
[Unit]
Description=Discord Content Announcement Bot
After=network.target

[Service]
Type=simple
User=%i
Environment="DISPLAY=:99"
ExecStart=%h/discord-bot/start-bot.sh
Restart=on-failure
RestartSec=10s
StandardOutput=syslog
StandardError=syslog

[Install]
WantedBy=multi-user.target
```

2. **Enable and start**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable discord-bot.service
sudo systemctl start discord-bot.service
```

## 🔍 How It Works

### 📺 YouTube Monitoring (PubSubHubbub + Fallback)
1. **🔗 Subscription:** Bot subscribes to YouTube's PubSubHubbub hub
2. **✅ Verification:** Hub sends verification challenge to bot's webhook
3. **🏁 Startup Scanning:** Bot scans Discord channel history for previously announced videos
4. **📡 Notifications:** Real-time POST requests for new videos/streams
5. **🔐 Verification:** HMAC-SHA1 signature validation
6. **📊 Processing:** Extract video details and check against known content
7. **🛡️ Fallback Protection:** If notifications fail, automatic retry with API polling backup
8. **📢 Announcement:** Post to Discord if content is new and not previously announced

**Persistent Duplicate Detection:**
- **History Scanning:** Scans up to 1000 recent messages in Discord channels on startup
- **Video ID Extraction:** Uses regex patterns to extract YouTube video IDs from message content
- **Memory Persistence:** Maintains in-memory cache of known content for O(1) duplicate checking
- **Cross-Restart Protection:** Prevents re-announcing videos after bot restarts or crashes

**Fallback System Features:**
- **Retry Queue:** Failed notifications queued with exponential backoff (5s, 15s, 45s)
- **API Polling:** Falls back to YouTube Data API when PubSubHubbub fails repeatedly
- **Gap Detection:** Identifies and recovers missed content during outages
- **Deduplication:** Prevents duplicate announcements across notification methods

### 🐦 X (Twitter) Monitoring (Scraping)
1. **🔄 Polling:** Periodic scraping of user's profile
2. **🔐 Authentication:** Persistent session management via `AuthManager`, with automated cookie handling and login fallback
3. **🏁 Startup Scanning:** Bot scans Discord channel history for previously announced tweets (all channels)
4. **📝 Filtering:** Check against known tweet IDs and timestamps
5. **📢 Categorization:** Sort by post type (original, reply, quote, retweet)
6. **📡 Announcement:** Post to appropriate Discord channels if not previously announced

**Enhanced Retweet Detection:**
- **Multi-Strategy Detection:** Uses three methods for comprehensive retweet identification:
  - **Author Comparison:** Primary method - if tweet author differs from monitored user, it's classified as a retweet
  - **Social Context:** Secondary method - detects modern retweet indicators (`data-testid="socialContext"` containing "reposted")
  - **Classic RT@ Pattern:** Tertiary method - traditional "RT @username" text pattern detection
- **Intelligent Classification:** Non-retweet content found during enhanced detection uses existing classification mechanisms
- **Dedicated Routing:** Retweets can be announced to separate Discord channels when configured

## 🧪 Testing Infrastructure

The bot includes a bulletproof testing infrastructure with **~70% source code coverage** and **350+ comprehensive tests**:

### 🧪 Testing Framework
- **Comprehensive Test Suite:** Multi-tier testing with Unit, Integration, E2E, Performance, and Security tests
- **Modular Architecture Testing:** Direct testing of extracted `src/` modules with clean interfaces
- **Cross-Platform Coverage:** Tests run on Node.js 18 and 20 across different environments
- **Real-time CI/CD:** GitHub Actions with automated testing on every push and pull request
- **Coverage Reporting:** Detailed code coverage metrics with HTML reports

### 🎯 Test Types & Coverage

| Test Type | Count | Purpose |
|-----------|-------|---------|
| **Unit** | 220+ | Component testing with mocking |
| **Integration** | 80+ | Service interaction testing |
| **E2E** | 35+ | Full workflow testing |
| **Performance** | 15+ | Load and response testing |
| **Security** | 10+ | Vulnerability scanning |

### 📊 Coverage Breakdown
- **Source Code Coverage:** ~70% (excellent implementation coverage) ✅
- **Overall Project:** ~30% (realistic when including all files) ✅
- **Core Logic:** 90%+ coverage (CommandProcessor, ContentClassifier) ✅
- **Infrastructure:** 70%+ coverage (DependencyContainer, Configuration) ✅
- **Critical Components:** Excellent coverage where it matters most ✅

### 🚀 CI/CD Features
- **Parallel Execution:** Tests run concurrently for faster feedback.
- **Fixed Coverage Reporting:** Industry-standard tools eliminate calculation errors and triple-counting.
- **Smart Coverage Merging:** CI properly accumulates coverage from different test types.
- **Test Summary Generation**: A `test-summary.md` file with the full output of all test suites is generated and uploaded as an artifact.
- **Commit Commenting**: The test summary is automatically posted as a comment on the corresponding commit.
- **Quality Gates:** Automated coverage validation with realistic thresholds focusing on implementation code.
- **Smart Detection:** Automatically identifies test failures and provides detailed reporting.
- **PR Integration:** Real-time test status in pull requests with accurate coverage summaries.
- **Comprehensive Artifacts:** Merged coverage reports and detailed test metrics are preserved and available for download.

### 📊 Test Commands
```bash
# Run all tests locally
npm test                    # Execute full test suite (350+ tests)
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:e2e           # End-to-end tests only
npm run test:performance   # Performance benchmarks
npm run test:security      # Security auditing

# Coverage reporting
npm run test:coverage      # Generate detailed coverage reports
npm run test:watch         # Watch mode for development
```

### 🛡️ Quality Gates
- **Current Coverage:** ~30% overall, with 75%+ on critical modules
- **Zero Failures:** All 350+ tests must pass before merging
- **Security Scanning:** No high/critical vulnerabilities allowed
- **Performance Benchmarks:** Response times within acceptable limits
- **Modular Testing:** Real source code testing with proper mocking

## 🛡️ Development & Security

### Pre-commit Hooks
Automated validation includes:
- 🔍 **Syntax checking** for all JavaScript files
- 🔒 **Security scanning** for hardcoded credentials
- ⚠️ **Validation** that encryption keys aren't committed

### Environment Validation
- ✅ **Startup validation** of required environment variables
- ⚠️ **Clear error messages** for missing configuration
- 🔐 **Security warnings** for default values

## ❓ Troubleshooting

### Common Issues

**🔌 `listen EADDRINUSE` error**
- Port `PSH_PORT` is already in use
- Change port or stop conflicting process

**📺 No YouTube announcements**
- ✅ Check `PSH_CALLBACK_URL` is publicly accessible
- 🔑 Verify YouTube API key and channel ID
- 📊 Check logs for subscription status
- 🔐 Ensure `PSH_SECRET` matches configuration
- 🛡️ Verify fallback system is enabled (`YOUTUBE_FALLBACK_ENABLED=true`)
- 📊 Check `!health` command for fallback system metrics

**🐦 No X announcements**
- 🔑 Verify Twitter credentials are valid
- 📝 Check X user handle is correct
- 📊 Review logs for scraping errors
- ⚡ Ensure announcement posting is enabled

**🎮 Commands not working**
- ✅ Verify correct command prefix
- 📢 Ensure commands sent in support channel
- 🔑 Check user authorization for restricted commands
- 🤖 Confirm Message Content Intent is enabled

### Logging & Debugging
- 📂 Check log files at configured `LOG_FILE_PATH`
- 🎛️ Use `!loglevel debug` for detailed output
- 📊 Monitor health endpoints for system status
- 🔍 Review Discord support channel for real-time logs

## 🤝 Contributing

We welcome contributions! Please:

1. 🍴 Fork the repository
2. 🌱 Create a feature branch
3. ✅ Ensure tests pass and pre-commit hooks succeed
4. 📝 Submit a pull request with clear description

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

⭐ **Star this repo if it helped you!** | 🐛 **Report issues** | 💡 **Suggest improvements**
