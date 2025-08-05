import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Process cleanup utilities for handling zombie browser instances
 */
export class ProcessCleanup {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Kill zombie browser processes that may be left behind
   * @returns {Promise<void>}
   */
  async killZombieBrowsers() {
    const operation = this.logger.startOperation('killZombieBrowsers');

    try {
      // Find chrome/chromium processes that aren't the main MCP browser
      const { stdout } = await execAsync(
        `pgrep -f "chrome.*--user-data-dir.*discord-bot|chromium.*--user-data-dir.*discord-bot" || true`
      );

      if (stdout.trim()) {
        const pids = stdout
          .trim()
          .split('\n')
          .filter(pid => pid.trim());
        operation.progress(`Found ${pids.length} potential zombie browser processes: ${pids.join(', ')}`);

        for (const pid of pids) {
          try {
            await execAsync(`kill -TERM ${pid}`);
            operation.progress(`Sent SIGTERM to process ${pid}`);

            // Wait a bit then force kill if still running
            setTimeout(async () => {
              try {
                await execAsync(`kill -9 ${pid} 2>/dev/null || true`);
              } catch {
                // Process already terminated
              }
            }, 5000);
          } catch (error) {
            operation.progress(`Failed to kill process ${pid}: ${error.message}`);
          }
        }

        operation.success(`Cleanup initiated for ${pids.length} browser processes`);
      } else {
        operation.success('No zombie browser processes found');
      }
    } catch (error) {
      operation.error(error, 'Failed to cleanup zombie browsers');
    }
  }

  /**
   * Get memory usage of browser processes
   * @returns {Promise<Object>} Memory usage statistics
   */
  async getBrowserMemoryUsage() {
    try {
      const { stdout } = await execAsync(
        `ps aux | grep -E "(chrome|chromium)" | grep -v grep | awk '{sum += $6} END {print sum ? sum/1024 : 0}'`
      );
      const memoryMB = parseFloat(stdout.trim()) || 0;

      return {
        totalMemoryMB: memoryMB,
        processCount: await this.getBrowserProcessCount(),
      };
    } catch (error) {
      this.logger.warn('Failed to get browser memory usage', { error: error.message });
      return { totalMemoryMB: 0, processCount: 0 };
    }
  }

  /**
   * Get count of browser processes
   * @returns {Promise<number>} Number of browser processes
   */
  async getBrowserProcessCount() {
    try {
      const { stdout } = await execAsync(`pgrep -f "(chrome|chromium)" | wc -l`);
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Monitor browser process health
   * @returns {Promise<Object>} Health status
   */
  async checkBrowserHealth() {
    const memUsage = await this.getBrowserMemoryUsage();
    const { processCount } = memUsage;

    const health = {
      healthy: true,
      warnings: [],
      memoryMB: memUsage.totalMemoryMB,
      processCount,
    };

    // Warn if too many browser processes
    if (processCount > 20) {
      health.healthy = false;
      health.warnings.push(`Too many browser processes: ${processCount}`);
    }

    // Warn if using too much memory (>2GB)
    if (memUsage.totalMemoryMB > 2048) {
      health.healthy = false;
      health.warnings.push(`High browser memory usage: ${memUsage.totalMemoryMB}MB`);
    }

    return health;
  }
}
