import { jest } from '@jest/globals';
import { delay } from '../../../src/utilities/delay.js';

describe('Delay Utility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should wait for the specified duration', async () => {
    const duration = 1000;
    const promise = delay(duration);

    // Fast-forward time
    jest.advanceTimersByTime(duration);

    // The promise should resolve after the delay
    await expect(promise).resolves.toBeUndefined();
  });
});
