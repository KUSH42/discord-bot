// index.js - Modern Discord YouTube Bot Entry Point
// © 2025 Marco Keller. All rights reserved. This software and its content are proprietary and confidential. Unauthorized reproduction or distribution is strictly prohibited.

import { config } from '@dotenvx/dotenvx';

import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'url';

// Infrastructure
import { Configuration } from './src/infrastructure/configuration.js';
import { DependencyContainer } from './src/infrastructure/dependency-container.js';

// Setup
import { setupProductionServices, setupWebhookEndpoints, createShutdownHandler } from './src/setup/production-setup.js';

// Load environment variables with encryption support
config();

/**
 * Main application entry point
 * WARNING: This starts real production applications with infinite background processes
 * DO NOT call this function in tests - it will cause hanging and memory leaks
 */
async function startBot() {
  // Safety guard to prevent accidental execution in test environment
  if (process.env.NODE_ENV === 'test') {
    throw new Error('startBot() should not be called in test environment - it starts infinite background processes');
  }
  let container;
  try {
    const configuration = new Configuration();
    container = new DependencyContainer();
    await setupProductionServices(container, configuration);
    const logger = container.resolve('logger');
    logger.info('🚀 Starting Discord YouTube Bot...');
    const { hasErrors } = await startApplications(container, configuration);
    await startWebServer(container, configuration);
    setupGracefulShutdown(container);

    // Listen for bot initialization completion event to enable comprehensive logging
    const eventBus = container.resolve('eventBus');
    const contentStateManager = container.resolve('contentStateManager');

    eventBus.on('bot.initialization.complete', event => {
      logger.info('Bot initialization complete - enabling comprehensive content evaluation logging', {
        timestamp: event.timestamp,
        historyScanned: event.historyScanned,
        error: event.error,
      });

      contentStateManager.markFullyInitialized();
    });

    if (hasErrors) {
      logger.warn('⚠️ Bot startup completed with some components disabled due to errors');
    } else {
      logger.info('✅ Bot startup completed successfully');
    }
    return container;
  } catch (error) {
    if (container && container.isRegistered('logger')) {
      container.resolve('logger').error('❌ Failed to start bot:', error);
    } else {
      console.error('❌ Failed to start bot:', error);
    }
    if (container) {
      await container.dispose();
    }
    throw error;
  }
}

async function main() {
  // Safety guard to prevent accidental execution in test environment
  if (process.env.NODE_ENV === 'test') {
    throw new Error(
      'main() should not be called in test environment - it starts infinite background processes via startBot()'
    );
  }
  let container;
  let restartUnsubscribe;
  try {
    container = await startBot();
    const eventBus = container.resolve('eventBus');
    restartUnsubscribe = eventBus.on('bot.request_restart', async () => {
      const logger = container.resolve('logger');
      logger.info('Restarting bot...');
      // Clean up the restart listener before disposing
      if (restartUnsubscribe) {
        restartUnsubscribe();
        restartUnsubscribe = null;
      }

      // Ensure proper disposal with delay to prevent Discord client overlap
      logger.info('Disposing old container...');
      await container.dispose();

      // Add a small delay to ensure Discord client is fully destroyed before creating new one
      logger.info('Waiting for cleanup completion...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      logger.info('Creating new container...');
      container = await startBot();

      // Re-register the restart listener for the new container
      const newEventBus = container.resolve('eventBus');
      restartUnsubscribe = newEventBus.on('bot.request_restart', arguments.callee);
      logger.info('Bot restart completed successfully');
    });
  } catch (error) {
    // Logger is not available here if startBot fails, so we log to console.
    // The error is already logged inside startBot's catch block.
    console.error('❌ Bot startup failed in main:', error.message);

    // Clean up on error
    if (restartUnsubscribe) {
      try {
        restartUnsubscribe();
      } catch (unsubscribeError) {
        console.error('Error cleaning up restart listener:', unsubscribeError);
      }
    }
    if (container) {
      try {
        await container.dispose();
      } catch (disposeError) {
        console.error('Error during cleanup:', disposeError);
      }
    }

    // Don't call process.exit here - let the caller handle it
    throw error;
  }
}

/**
 * Start core applications (Bot, Monitor, Scraper)
 */
async function startApplications(container, config) {
  const logger = container.resolve('logger').child({ service: 'Main' });
  let hasErrors = false;

  // Start Discord Bot
  const botApp = container.resolve('botApplication');
  await botApp.start();

  // Start YouTube Monitor
  const monitorApp = container.resolve('monitorApplication');
  await monitorApp.start();

  // Start X Scraper (if enabled)
  const xUser = config.get('X_USER_HANDLE');
  if (xUser) {
    try {
      const scraperApp = container.resolve('scraperApplication');
      await scraperApp.start();
    } catch (error) {
      hasErrors = true;
      logger.error('❌ Failed to start X Scraper application:', error.message);
      logger.warn('X Scraper will be disabled - YouTube monitoring will continue normally');
    }
  } else {
    logger.info('X Scraper disabled (no X_USER_HANDLE configured)');
  }

  return { hasErrors };
}

/**
 * Start web server for webhooks and health checks
 */
async function startWebServer(container, config) {
  const logger = container.resolve('logger');
  const app = container.resolve('expressApp');

  // Set up rate limiting
  const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
  });

  const commandLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // Limit each IP to 5 requests per minute
    message: 'Too many commands from this IP',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Apply rate limiting to webhook endpoints
  app.use('/youtube-webhook', webhookLimiter);
  app.use('/api/', commandLimiter);

  // Set up webhook endpoints
  setupWebhookEndpoints(app, container);

  // Error handling middleware
  app.use((error, req, res, _next) => {
    logger.error('Express error:', {
      message: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
    });
    res.status(500).json({ error: 'Internal Server Error' });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Start server
  const port = config.get('PSH_PORT', 3000);
  const server = app.listen(port, () => {
    logger.info(`🌐 Web server listening on port ${port}`);
  });

  // Store server reference for graceful shutdown
  container.registerInstance('httpServer', server);
}

/**
 * Set up graceful shutdown handlers
 */
function setupGracefulShutdown(container) {
  const shutdownHandler = createShutdownHandler(container);

  // Handle various shutdown signals
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGUSR1', () => shutdownHandler('SIGUSR1'));
  process.on('SIGUSR2', () => shutdownHandler('SIGUSR2'));

  // Handle uncaught exceptions
  process.on('uncaughtException', async error => {
    const logger = container.resolve('logger');
    logger.error('Uncaught Exception:', error);
    await shutdownHandler('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    const logger = container.resolve('logger');
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await shutdownHandler('unhandledRejection');
  });
}

// Only run when executed directly (not imported in tests)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export { main };
