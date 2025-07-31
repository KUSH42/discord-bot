/**
 * Open Handle Detection Utility for Jest Tests
 *
 * This utility helps identify and diagnose open handles that prevent Jest from exiting cleanly.
 * Use this when Jest hangs or you need to debug async resource leaks.
 */

import { AsyncResource } from 'async_hooks';
import { createHook } from 'async_hooks';

class OpenHandleDetector {
  constructor() {
    this.activeHandles = new Map();
    this.hook = null;
    this.isTracking = false;
    this.initialHandles = new Set();
  }

  /**
   * Start tracking async resources
   */
  startTracking() {
    if (this.isTracking) {
      return;
    }

    // Capture initial handles
    this.captureInitialHandles();

    this.hook = createHook({
      init: (asyncId, type, triggerAsyncId) => {
        this.activeHandles.set(asyncId, {
          type,
          triggerAsyncId,
          stack: new Error().stack,
          created: Date.now(),
        });
      },
      destroy: asyncId => {
        this.activeHandles.delete(asyncId);
      },
    });

    this.hook.enable();
    this.isTracking = true;
  }

  /**
   * Stop tracking and cleanup
   */
  stopTracking() {
    if (!this.isTracking) {
      return;
    }

    if (this.hook) {
      this.hook.disable();
      this.hook = null;
    }
    this.isTracking = false;
  }

  /**
   * Capture handles that exist before test starts
   */
  captureInitialHandles() {
    const handles = process._getActiveHandles();
    const requests = process._getActiveRequests();

    handles.forEach((handle, index) => {
      this.initialHandles.add(`handle-${index}-${handle.constructor.name}`);
    });

    requests.forEach((request, index) => {
      this.initialHandles.add(`request-${index}-${request.constructor.name}`);
    });
  }

  /**
   * Get current open handles analysis
   */
  getOpenHandles() {
    const handles = process._getActiveHandles();
    const requests = process._getActiveRequests();

    return {
      handles: this.analyzeHandles(handles),
      requests: this.analyzeRequests(requests),
      summary: {
        totalHandles: handles.length,
        totalRequests: requests.length,
        newSinceStart: this.getNewHandlesSinceStart(handles, requests),
      },
    };
  }

  /**
   * Analyze handle objects
   */
  analyzeHandles(handles) {
    return handles.map((handle, index) => {
      const info = {
        index,
        type: handle.constructor.name,
        id: `handle-${index}-${handle.constructor.name}`,
      };

      // Extract additional info based on handle type
      if (handle.constructor.name === 'Timeout') {
        info.details = {
          hasRef: handle.hasRef && handle.hasRef(),
          timeout: handle._idleTimeout,
          repeat: handle._repeat,
        };
      } else if (handle.constructor.name === 'Socket') {
        info.details = {
          readable: handle.readable,
          writable: handle.writable,
          destroyed: handle.destroyed,
          connecting: handle.connecting,
        };
      } else if (handle.constructor.name === 'Server') {
        info.details = {
          listening: handle.listening,
          address: handle.address && handle.address(),
        };
      } else if (handle.constructor.name === 'ChildProcess') {
        info.details = {
          pid: handle.pid,
          killed: handle.killed,
          connected: handle.connected,
        };
      }

      return info;
    });
  }

  /**
   * Analyze request objects
   */
  analyzeRequests(requests) {
    return requests.map((request, index) => ({
      index,
      type: request.constructor.name,
      id: `request-${index}-${request.constructor.name}`,
      details: {
        method: request.method,
        path: request.path,
        host: request.host,
      },
    }));
  }

  /**
   * Get handles that are new since tracking started
   */
  getNewHandlesSinceStart(handles, requests) {
    const current = new Set();

    handles.forEach((handle, index) => {
      current.add(`handle-${index}-${handle.constructor.name}`);
    });

    requests.forEach((request, index) => {
      current.add(`request-${index}-${request.constructor.name}`);
    });

    const newHandles = [];
    current.forEach(id => {
      if (!this.initialHandles.has(id)) {
        newHandles.push(id);
      }
    });

    return newHandles;
  }

  /**
   * Generate a detailed report
   */
  generateReport() {
    const analysis = this.getOpenHandles();

    let report = '\n=== OPEN HANDLE ANALYSIS ===\n';
    report += `Total Handles: ${analysis.summary.totalHandles}\n`;
    report += `Total Requests: ${analysis.summary.totalRequests}\n`;
    report += `New Since Start: ${analysis.summary.newSinceStart.length}\n\n`;

    if (analysis.handles.length > 0) {
      report += '--- ACTIVE HANDLES ---\n';
      analysis.handles.forEach(handle => {
        report += `${handle.index}: ${handle.type}`;
        if (handle.details) {
          report += ` (${JSON.stringify(handle.details)})`;
        }
        report += '\n';
      });
      report += '\n';
    }

    if (analysis.requests.length > 0) {
      report += '--- ACTIVE REQUESTS ---\n';
      analysis.requests.forEach(request => {
        report += `${request.index}: ${request.type}`;
        if (request.details) {
          report += ` (${JSON.stringify(request.details)})`;
        }
        report += '\n';
      });
      report += '\n';
    }

    if (analysis.summary.newSinceStart.length > 0) {
      report += '--- NEW HANDLES SINCE TEST START ---\n';
      analysis.summary.newSinceStart.forEach(id => {
        report += `- ${id}\n`;
      });
    }

    return report;
  }

  /**
   * Force close common types of open handles
   */
  forceCloseHandles() {
    const handles = process._getActiveHandles();
    let closed = 0;

    handles.forEach(handle => {
      try {
        if (handle.constructor.name === 'Timeout') {
          clearTimeout(handle);
          closed++;
        } else if (handle.constructor.name === 'Immediate') {
          clearImmediate(handle);
          closed++;
        } else if (handle.constructor.name === 'Socket' && !handle.destroyed) {
          handle.destroy();
          closed++;
        } else if (handle.constructor.name === 'Server' && handle.listening) {
          handle.close();
          closed++;
        }
      } catch (error) {
        // Ignore errors during forced cleanup
      }
    });

    return closed;
  }
}

/**
 * Global instance for easy access
 */
const detector = new OpenHandleDetector();

/**
 * Jest setup functions
 */
export const setupOpenHandleDetection = () => {
  beforeEach(() => {
    detector.startTracking();
  });

  afterEach(() => {
    detector.stopTracking();
  });
};

/**
 * Debug function to print current open handles
 */
export const debugOpenHandles = () => {
  console.log(detector.generateReport());
};

/**
 * Force cleanup function for tests
 */
export const forceCloseOpenHandles = () => {
  const closed = detector.forceCloseHandles();
  console.log(`Forcefully closed ${closed} handles`);
  return closed;
};

/**
 * Create a test wrapper that automatically detects handles
 */
export const withHandleDetection = testFn => {
  return async (...args) => {
    detector.startTracking();

    try {
      await testFn(...args);
    } finally {
      const report = detector.generateReport();
      if (report.includes('New Since Start: 0') === false) {
        console.warn('Open handles detected:', report);
      }
      detector.stopTracking();
    }
  };
};

/**
 * Wait for all handles to close (useful for async cleanup)
 */
export const waitForHandleCleanup = async (timeoutMs = 5000, checkIntervalMs = 100) => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const analysis = detector.getOpenHandles();
    if (analysis.summary.newSinceStart.length === 0) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }

  return false;
};

export default detector;
