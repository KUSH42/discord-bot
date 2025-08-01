// x-scraper.js - Standalone X (Twitter) Scraper Entry Point
// © 2025 Marco Keller. All rights reserved. This software and its content are proprietary and confidential. Unauthorized reproduction or distribution is strictly prohibited.

import { config } from '@dotenvx/dotenvx';
import { pathToFileURL } from 'url';

// Infrastructure
import { Configuration } from './infrastructure/configuration.js';
import { DependencyContainer } from './infrastructure/dependency-container.js';

// Setup
import { setupProductionServices, createShutdownHandler } from './setup/production-setup.js';

// Load environment variables with encryption support
config();

/**
 * Standalone X (Twitter) Scraper application
 * WARNING: This starts real production scraper with infinite background processes
 * DO NOT call this function in tests - it will cause hanging and memory leaks
 */
async function main() {
  // Safety guard to prevent accidental execution in test environment
  if (process.env.NODE_ENV === 'test') {
    throw new Error(
      'x-scraper main() should not be called in test environment - it starts infinite background processes'
    );
  }
  let container, logger;

  try {
    // Initialize configuration
    const configuration = new Configuration();

    // Create dependency container
    container = new DependencyContainer();

    // Set up all services
    await setupProductionServices(container, configuration);

    // Get logger
    logger = container.resolve('logger');
    logger.info('🐦 Starting X Scraper...');

    // Verify X configuration
    const xUser = configuration.get('X_USER_HANDLE');
    if (!xUser) {
      throw new Error('X_USER_HANDLE not configured. X Scraper cannot start without a target user.');
    }

    // Start only the X Scraper application
    const scraperApp = container.resolve('scraperApplication');
    await scraperApp.start();

    // Set up graceful shutdown
    const shutdownHandler = createShutdownHandler(container);
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));

    logger.info(`✅ X Scraper started successfully, monitoring @${xUser}`);

    // Keep the process alive
    process.on('uncaughtException', error => {
      logger.error('Uncaught Exception:', error);
      shutdownHandler('uncaughtException');
    });

    process.on('unhandledRejection', (reason, _promise) => {
      logger.error(`Unhandled Rejection: ${reason.stack || reason}`);
      shutdownHandler('unhandledRejection');
    });
  } catch (error) {
    if (logger) {
      logger.error('❌ Failed to start X Scraper:', error);
    } else {
      console.error('❌ Failed to start X Scraper:', error);
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

// Only run when executed directly (not imported)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing and integration
export { main };
