import { nowUTC } from './utc-time.js';
import fs from 'fs';

/**
 * Crash Detection and Reporting System
 * Captures silent crashes and provides detailed crash logs
 */
export class CrashDetector {
  constructor(logger) {
    this.logger = logger;
    this.crashLogFile = 'crash-log.json';
    this.isSetup = false;
    this.lastHeartbeat = Date.now();
    this.heartbeatInterval = null;
  }

  /**
   * Setup comprehensive crash detection
   */
  setup() {
    if (this.isSetup) {
      return;
    }

    this.logger.info('🕵️ Setting up comprehensive crash detection system');

    // 1. Monitor unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logCrash('unhandledRejection', {
        reason: reason?.message || reason,
        stack: reason?.stack,
        promise: promise.toString(),
        timestamp: nowUTC(),
      });
    });

    // 2. Monitor uncaught exceptions
    process.on('uncaughtException', error => {
      this.logCrash('uncaughtException', {
        error: error.message,
        stack: error.stack,
        timestamp: nowUTC(),
      });
    });

    // 3. Monitor process warnings
    process.on('warning', warning => {
      this.logCrash('processWarning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
        timestamp: nowUTC(),
      });
    });

    // 4. Monitor memory usage
    process.on('message', message => {
      if (message === 'low-memory') {
        this.logCrash('lowMemory', {
          memoryUsage: process.memoryUsage(),
          timestamp: nowUTC(),
        });
      }
    });

    // 5. Monitor exit events
    process.on('exit', code => {
      this.logCrash('processExit', {
        exitCode: code,
        timestamp: nowUTC(),
        lastHeartbeat: new Date(this.lastHeartbeat).toISOString(),
      });
    });

    // 6. Monitor SIGTERM/SIGINT
    process.on('SIGTERM', () => {
      this.logCrash('SIGTERM', {
        timestamp: nowUTC(),
        memoryUsage: process.memoryUsage(),
      });
    });

    process.on('SIGINT', () => {
      this.logCrash('SIGINT', {
        timestamp: nowUTC(),
        memoryUsage: process.memoryUsage(),
      });
    });

    // 7. Start heartbeat monitoring
    this.startHeartbeat();

    this.isSetup = true;
    this.logger.info('✅ Crash detection system active');
  }

  /**
   * Start heartbeat monitoring to detect silent crashes
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.lastHeartbeat = Date.now();

      // Log periodic health check
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      if (heapUsedMB > 2048) {
        // Log if over 2GB
        this.logger.warn('🚨 High memory usage detected', {
          heapUsedMB,
          memoryUsage: memUsage,
          timestamp: nowUTC(),
        });

        this.logCrash('highMemoryUsage', {
          heapUsedMB,
          memoryUsage: memUsage,
          timestamp: nowUTC(),
        });
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Log crash information to file and logger
   */
  logCrash(type, details) {
    const crashInfo = {
      type,
      details,
      timestamp: nowUTC(),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };

    // Log to Winston logger
    try {
      this.logger.error(`💥 CRASH DETECTED: ${type}`, crashInfo);
    } catch (logError) {
      // If logger fails, write to stderr
      console.error('💥 CRASH DETECTED (logger failed):', JSON.stringify(crashInfo, null, 2));
    }

    // Write to crash log file
    try {
      let existingCrashes = [];
      if (fs.existsSync(this.crashLogFile)) {
        const content = fs.readFileSync(this.crashLogFile, 'utf8');
        existingCrashes = JSON.parse(content);
      }

      existingCrashes.push(crashInfo);

      // Keep only last 100 crashes
      if (existingCrashes.length > 100) {
        existingCrashes = existingCrashes.slice(-100);
      }

      fs.writeFileSync(this.crashLogFile, JSON.stringify(existingCrashes, null, 2));
    } catch (fileError) {
      console.error('Failed to write crash log to file:', fileError);
    }
  }

  /**
   * Get recent crash information
   */
  getRecentCrashes(count = 10) {
    try {
      if (!fs.existsSync(this.crashLogFile)) {
        return [];
      }

      const content = fs.readFileSync(this.crashLogFile, 'utf8');
      const crashes = JSON.parse(content);
      return crashes.slice(-count);
    } catch (error) {
      this.logger.error('Failed to read crash log:', error);
      return [];
    }
  }

  /**
   * Stop crash detection
   */
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.logger.info('🛑 Crash detection system stopped');
  }
}
