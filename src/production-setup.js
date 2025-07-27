import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { google } from 'googleapis';
import express from 'express';
import { exec } from 'child_process';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

// Infrastructure
// Infrastructure classes imported for JSDoc type annotations
// import { Configuration } from '../infrastructure/configuration.js';
// import { DependencyContainer } from '../infrastructure/dependency-container.js';
import { EventBus } from '../infrastructure/event-bus.js';
import { StateManager } from '../infrastructure/state-manager.js';
import { PersistentStorage } from '../infrastructure/persistent-storage.js';

// Core Logic
import { DuplicateDetector } from '../duplicate-detector.js';

// Services
import { DiscordClientService } from '../services/implementations/discord-client-service.js';
import { YouTubeApiService } from '../services/implementations/youtube-api-service.js';
import { FetchHttpService } from '../services/implementations/fetch-http-service.js';
import { PlaywrightBrowserService } from '../services/implementations/playwright-browser-service.js';

// Core Logic
import { CommandProcessor } from '../core/command-processor.js';
import { ContentClassifier } from '../core/content-classifier.js';
import { ContentAnnouncer } from '../core/content-announcer.js';
import { ContentCoordinator } from '../core/content-coordinator.js';
import { ContentStateManager } from '../core/content-state-manager.js';
import { LivestreamStateMachine } from '../core/livestream-state-machine.js';

// Services
import { YouTubeScraperService } from '../services/implementations/youtube-scraper-service.js';

// Applications
import { AuthManager } from '../application/auth-manager.js';
import { BotApplication } from '../application/bot-application.js';
import { ScraperApplication } from '../application/scraper-application.js';
import { MonitorApplication } from '../application/monitor-application.js';

// Utils
import { DiscordTransport, LoggerUtils } from '../logger-utils.js';
const { createConsoleLogFormat, createFileLogFormat } = LoggerUtils;

/**
 * Set up all production services and dependencies
 * @param {DependencyContainer} container - Dependency container
 * @param {Configuration} config - Configuration instance
 * @returns {Promise<void>}
 */
export async function setupProductionServices(container, config) {
  // Register infrastructure services
  await setupInfrastructureServices(container, config);

  // Register external services
  await setupExternalServices(container, config);

  // Register core business logic
  await setupCoreServices(container, config);

  // Register application services
  await setupApplicationServices(container, config);

  // Set up logging
  await setupLogging(container, config);

  // Set up Discord logging transport (after both services exist)
  await setupDiscordLogging(container, config);

  // Validate container
  container.validate();
}

/**
 * Set up infrastructure services
 */
async function setupInfrastructureServices(container, config) {
  // Configuration (already created)
  container.registerInstance('config', config);

  // Event Bus
  container.registerSingleton('eventBus', () => new EventBus());

  // State Manager with initial state
  container.registerSingleton('stateManager', () => {
    const state = new StateManager({
      botStartTime: new Date(),
      postingEnabled: true,
      announcementEnabled: config.getBoolean('ANNOUNCEMENT_ENABLED', false),
      vxTwitterConversionEnabled: config.getBoolean('X_VX_TWITTER_CONVERSION', false),
      logLevel: config.get('LOG_LEVEL', 'info'),
    });
    return state;
  });

  // Persistent Storage
  container.registerSingleton('persistentStorage', c => {
    return new PersistentStorage(c.resolve('logger').child({ service: 'PersistentStorage' }));
  });
}

/**
 * Set up external services (Discord, YouTube, HTTP)
 */
async function setupExternalServices(container, config) {
  // Discord Client Service
  container.registerSingleton('discordService', c => {
    const logger = c.resolve('logger').child({ service: 'DiscordClientService' });

    logger.info('Creating new Discord client instance');
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });

    // Add unique client identifier for debugging
    client._botInstanceId = Date.now();
    logger.info(`Discord client created with instance ID: ${client._botInstanceId}`);

    return new DiscordClientService(client, logger);
  });

  // YouTube API Service
  container.registerSingleton('youtubeService', c => {
    const youtube = google.youtube({
      version: 'v3',
      auth: config.getRequired('YOUTUBE_API_KEY'),
    });

    return new YouTubeApiService({
      logger: c.resolve('logger').child({ service: 'YouTubeApiService' }),
      youtube,
    });
  });

  // HTTP Service
  container.registerSingleton('httpService', () => {
    return new FetchHttpService({
      timeout: 30000,
      headers: {
        'User-Agent': 'Discord-YouTube-Bot/1.0',
      },
    });
  });

  // Express App for webhooks
  container.registerSingleton('expressApp', () => {
    const app = express();

    // Middleware for raw body (needed for webhook signature verification)
    app.use('/youtube-webhook', express.raw({ type: 'application/atom+xml' }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    return app;
  });

  // Browser Service
  container.registerSingleton('browserService', () => {
    return new PlaywrightBrowserService();
  });
}

/**
 * Set up core business logic services
 */
async function setupCoreServices(container, _config) {
  // Command Processor
  container.registerSingleton('commandProcessor', c => {
    return new CommandProcessor(c.resolve('config'), c.resolve('stateManager'));
  });

  // Content Classifier
  container.registerSingleton('contentClassifier', () => {
    return new ContentClassifier();
  });

  // Content Announcer
  container.registerSingleton('contentAnnouncer', c => {
    return new ContentAnnouncer(c.resolve('discordService'), c.resolve('config'), c.resolve('stateManager'));
  });

  // Duplicate Detector
  container.registerSingleton('duplicateDetector', c => {
    return new DuplicateDetector(
      c.resolve('persistentStorage'),
      c.resolve('logger').child({ service: 'DuplicateDetector' })
    );
  });

  // Content State Manager
  container.registerSingleton('contentStateManager', c => {
    return new ContentStateManager(
      c.resolve('config'),
      c.resolve('persistentStorage'),
      c.resolve('logger').child({ service: 'ContentStateManager' })
    );
  });

  // Content Coordinator
  container.registerSingleton('contentCoordinator', c => {
    return new ContentCoordinator(
      c.resolve('contentStateManager'),
      c.resolve('contentAnnouncer'),
      c.resolve('duplicateDetector'),
      c.resolve('logger').child({ service: 'ContentCoordinator' }),
      c.resolve('config')
    );
  });

  // Livestream State Machine
  container.registerSingleton('livestreamStateMachine', c => {
    return new LivestreamStateMachine(
      c.resolve('contentStateManager'),
      c.resolve('logger').child({ service: 'LivestreamStateMachine' })
    );
  });
}

/**
 * Set up application services
 */
async function setupApplicationServices(container, _config) {
  // Bot Application
  container.registerSingleton('botApplication', c => {
    return new BotApplication({
      exec,
      discordService: c.resolve('discordService'),
      commandProcessor: c.resolve('commandProcessor'),
      eventBus: c.resolve('eventBus'),
      config: c.resolve('config'),
      stateManager: c.resolve('stateManager'),
      logger: c.resolve('logger').child({ service: 'BotApplication' }),
      scraperApplication: c.resolve('scraperApplication'),
      monitorApplication: c.resolve('monitorApplication'),
      youtubeScraperService: c.resolve('youtubeScraperService'),
    });
  });

  // Auth Manager
  container.registerSingleton('authManager', c => {
    return new AuthManager({
      browserService: c.resolve('browserService'),
      config: c.resolve('config'),
      stateManager: c.resolve('stateManager'),
      logger: c.resolve('logger').child({ service: 'AuthManager' }),
    });
  });

  // Scraper Application (X/Twitter monitoring)
  container.registerSingleton('scraperApplication', c => {
    return new ScraperApplication({
      browserService: c.resolve('browserService'),
      contentClassifier: c.resolve('contentClassifier'),
      discordService: c.resolve('discordService'),
      contentAnnouncer: c.resolve('contentAnnouncer'),
      config: c.resolve('config'),
      stateManager: c.resolve('stateManager'),
      eventBus: c.resolve('eventBus'),
      logger: c.resolve('logger').child({ service: 'ScraperApplication' }),
      authManager: c.resolve('authManager'),
      duplicateDetector: c.resolve('duplicateDetector'),
      persistentStorage: c.resolve('persistentStorage'),
    });
  });

  // Monitor Application (YouTube monitoring)
  container.registerSingleton('monitorApplication', c => {
    return new MonitorApplication({
      youtubeService: c.resolve('youtubeService'),
      httpService: c.resolve('httpService'),
      contentClassifier: c.resolve('contentClassifier'),
      contentAnnouncer: c.resolve('contentAnnouncer'),
      config: c.resolve('config'),
      stateManager: c.resolve('stateManager'),
      eventBus: c.resolve('eventBus'),
      logger: c.resolve('logger').child({ service: 'MonitorApplication' }),
      contentStateManager: c.resolve('contentStateManager'),
      livestreamStateMachine: c.resolve('livestreamStateMachine'),
      contentCoordinator: c.resolve('contentCoordinator'),
      duplicateDetector: c.resolve('duplicateDetector'),
      persistentStorage: c.resolve('persistentStorage'),
    });
  });

  // YouTube Scraper Service
  container.registerSingleton('youtubeScraperService', c => {
    return new YouTubeScraperService({
      logger: c.resolve('logger').child({ service: 'YouTubeScraperService' }),
      config: c.resolve('config'),
      contentCoordinator: c.resolve('contentCoordinator'),
    });
  });
}

/**
 * Set up logging infrastructure
 */
async function setupLogging(container, config) {
  container.registerSingleton('logger', _c => {
    const logLevel = config.get('LOG_LEVEL', 'info');
    const logFilePath = config.get('LOG_FILE_PATH', 'bot.log');

    // Create transports
    const transports = [
      // Console transport
      new winston.transports.Console({
        level: logLevel,
        format: createConsoleLogFormat(),
      }),

      // File transport with rotation
      new winston.transports.DailyRotateFile({
        level: logLevel,
        filename: logFilePath.replace('.log', '-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: createFileLogFormat(),
      }),
    ];

    // Note: Discord transport will be added later to avoid circular dependency
    // between logger and discordService
    return winston.createLogger({
      level: logLevel,
      format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true })),
      transports,
    });
  });
}

/**
 * Configure Discord logging transport after both logger and discordService are created
 */
async function setupDiscordLogging(container, config) {
  const supportChannelId = config.get('DISCORD_BOT_SUPPORT_LOG_CHANNEL');
  // Skip Discord logging setup in test environment to prevent rate limit errors
  if (supportChannelId && process.env.NODE_ENV !== 'test') {
    const logger = container.resolve('logger');
    const discordService = container.resolve('discordService');
    const logLevel = config.get('LOG_LEVEL', 'info');

    // Add Discord transport to existing logger with balanced rate limiting
    // Only log warn and above to Discord to reduce spam
    const discordTransport = new DiscordTransport({
      level: 'warn', // Only log warnings, errors, and above to Discord
      client: discordService.client,
      channelId: supportChannelId,
      flushInterval: 3000, // 3 seconds to match send delay
      maxBufferSize: 15, // Match burst allowance
      burstAllowance: 15, // Allow reasonable burst for startup logging
      burstResetTime: 120000, // 2 minutes - longer reset for better recovery
      baseSendDelay: 3000, // 3 seconds between sends - conservative but functional
      testMode: false, // Ensure production mode rate limiting
    });

    logger.add(discordTransport);
  }
}

/**
 * Set up webhook endpoints
 * @param {express.Application} app - Express application
 * @param {DependencyContainer} container - Dependency container
 */
export function setupWebhookEndpoints(app, container) {
  const monitorApplication = container.resolve('monitorApplication');
  const logger = container.resolve('logger');

  // YouTube PubSubHubbub webhook
  app.all('/youtube-webhook', async (req, res) => {
    const requestStart = Date.now();
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    try {
      // Log incoming webhook request details
      logger.info('[WEBHOOK-ENDPOINT] Incoming request', {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length'],
        remoteAddress: req.ip || req.connection.remoteAddress,
        forwardedFor: req.headers['x-forwarded-for'],
        hasSignature: !!req.headers['x-hub-signature'],
      });

      const result = await monitorApplication.handleWebhook({
        method: req.method,
        headers: req.headers,
        query: req.query,
        body: req.body,
      });

      const processingTime = Date.now() - requestStart;

      logger.info('[WEBHOOK-ENDPOINT] Request processed', {
        requestId,
        status: result.status,
        processingTime,
        responseMessage: result.message,
      });

      res.status(result.status);
      if (result.body) {
        res.send(result.body);
      } else {
        res.send(result.message || 'OK');
      }
    } catch (error) {
      const processingTime = Date.now() - requestStart;

      logger.error('[WEBHOOK-ENDPOINT] Webhook error:', {
        requestId,
        error: error.message,
        stack: error.stack,
        processingTime,
        method: req.method,
        url: req.url,
      });

      res.status(500).send('Internal Server Error');
    }
  });

  // Health check endpoints
  app.get('/health', (req, res) => {
    const botApp = container.resolve('botApplication');
    const status = botApp.getStatus();

    res.json({
      status: status.isRunning && status.isDiscordReady ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get('/health/detailed', (req, res) => {
    const botApp = container.resolve('botApplication');
    const scraperApp = container.resolve('scraperApplication');
    const monitorApp = container.resolve('monitorApplication');

    res.json({
      bot: botApp.getStatus(),
      scraper: scraperApp.getStats(),
      monitor: monitorApp.getStats(),
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.get('/ready', (req, res) => {
    const botApp = container.resolve('botApplication');
    const status = botApp.getStatus();

    if (status.isRunning && status.isDiscordReady) {
      res.status(200).send('Ready');
    } else {
      res.status(503).send('Not Ready');
    }
  });
}

/**
 * Graceful shutdown handler
 * @param {DependencyContainer} container - Dependency container
 * @returns {Function} Shutdown function
 */
export function createShutdownHandler(container) {
  return async signal => {
    const logger = container.resolve('logger');
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    let hasError = false;

    try {
      // Stop applications
      const botApp = container.resolve('botApplication');
      const scraperApp = container.resolve('scraperApplication');
      const monitorApp = container.resolve('monitorApplication');

      // Stop applications individually to handle failures gracefully
      try {
        await botApp.stop();
      } catch (error) {
        logger.error('Error stopping bot application:', error);
        hasError = true;
      }

      try {
        await scraperApp.stop();
      } catch (error) {
        logger.error('Error stopping scraper application:', error);
        hasError = true;
      }

      try {
        await monitorApp.stop();
      } catch (error) {
        logger.error('Error stopping monitor application:', error);
        hasError = true;
      }

      // Dispose of container resources
      try {
        await container.dispose();
      } catch (error) {
        logger.error('Error disposing container:', error);
        hasError = true;
      }

      if (hasError) {
        logger.error('Graceful shutdown completed with errors');
        process.exit(1);
        return; // For test compatibility when process.exit is mocked
      } else {
        logger.info('Graceful shutdown completed');
        process.exit(0);
        return; // For test compatibility when process.exit is mocked
      }
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
      return; // For test compatibility when process.exit is mocked
    }
  };
}
