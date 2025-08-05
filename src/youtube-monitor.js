// youtube-monitor.js - Standalone YouTube Monitor Entry Point
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
 * Standalone YouTube Monitor application
 * WARNING: This starts real production monitor with infinite background processes
 * DO NOT call this function in tests - it will cause hanging and memory leaks
 */
async function main() {
  // Safety guard to prevent accidental execution in test environment
  if (process.env.NODE_ENV === 'test') {
    throw new Error(
      'youtube-monitor main() should not be called in test environment - it starts infinite background processes'
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
    logger.info('🎬 Starting YouTube Monitor...');

    // Start only the YouTube Monitor application
    const monitorApp = container.resolve('monitorApplication');
    await monitorApp.start();

    // Set up graceful shutdown
    const shutdownHandler = createShutdownHandler(container);
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));

    logger.info('✅ YouTube Monitor started successfully');

    // Keep the process alive
    process.on('uncaughtException', error => {
      logger.error('Uncaught Exception:', error);
      shutdownHandler('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      shutdownHandler('unhandledRejection');
    });

    logger.info('✅ YouTube Monitor started successfully');
  } catch (error) {
    if (logger) {
      logger.error('❌ Failed to start YouTube Monitor:', error);
    } else {
      console.error('❌ Failed to start YouTube Monitor:', error);
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
