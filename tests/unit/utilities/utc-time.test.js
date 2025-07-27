/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import {
  nowUTC,
  timestampUTC,
  getCurrentHourUTC,
  getCurrentDayUTC,
  dateFromTimestamp,
  parseISOString,
  toISOStringUTC,
  dateToISOString,
  isNightTimeUTC,
  isWeekendUTC,
  daysAgoUTC,
  hoursAgoUTC,
  minutesAgoUTC,
  secondsAgoUTC,
} from '../../../src/utilities/utc-time.js';

describe('UTC Time Utilities', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Set to a known UTC time: 2024-01-15T14:30:00.000Z (Monday, 2:30 PM UTC)
    jest.setSystemTime(new Date('2024-01-15T14:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('nowUTC', () => {
    it('should return current UTC time', () => {
      const result = nowUTC();
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });
  });

  describe('timestampUTC', () => {
    it('should return current UTC timestamp', () => {
      const result = timestampUTC();
      expect(result).toBe(new Date('2024-01-15T14:30:00.000Z').getTime());
    });
  });

  describe('getCurrentHourUTC', () => {
    it('should return current UTC hour', () => {
      const result = getCurrentHourUTC();
      expect(result).toBe(14);
    });

    it('should handle edge cases', () => {
      jest.setSystemTime(new Date('2024-01-15T00:00:00.000Z'));
      expect(getCurrentHourUTC()).toBe(0);

      jest.setSystemTime(new Date('2024-01-15T23:59:59.999Z'));
      expect(getCurrentHourUTC()).toBe(23);
    });
  });

  describe('getCurrentDayUTC', () => {
    it('should return current UTC day of week', () => {
      // 2024-01-15 is a Monday (day 1)
      const result = getCurrentDayUTC();
      expect(result).toBe(1);
    });

    it('should handle Sunday correctly', () => {
      jest.setSystemTime(new Date('2024-01-14T12:00:00.000Z')); // Sunday
      expect(getCurrentDayUTC()).toBe(0);
    });

    it('should handle Saturday correctly', () => {
      jest.setSystemTime(new Date('2024-01-13T12:00:00.000Z')); // Saturday
      expect(getCurrentDayUTC()).toBe(6);
    });
  });

  describe('dateFromTimestamp', () => {
    it('should create Date from timestamp', () => {
      const timestamp = new Date('2024-01-15T14:30:00.000Z').getTime();
      const result = dateFromTimestamp(timestamp);
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });
  });

  describe('parseISOString', () => {
    it('should parse ISO string to Date', () => {
      const isoString = '2024-01-15T14:30:00.000Z';
      const result = parseISOString(isoString);
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe(isoString);
    });
  });

  describe('toISOStringUTC', () => {
    it('should return current time as ISO string', () => {
      const result = toISOStringUTC();
      expect(result).toBe('2024-01-15T14:30:00.000Z');
    });
  });

  describe('dateToISOString', () => {
    it('should convert Date to ISO string', () => {
      const date = new Date('2024-01-15T14:30:00.000Z');
      const result = dateToISOString(date);
      expect(result).toBe('2024-01-15T14:30:00.000Z');
    });
  });

  describe('isNightTimeUTC', () => {
    it('should return false for afternoon time', () => {
      // Current time is 14:30 UTC
      expect(isNightTimeUTC()).toBe(false);
    });

    it('should return true for early morning', () => {
      jest.setSystemTime(new Date('2024-01-15T04:00:00.000Z'));
      expect(isNightTimeUTC()).toBe(true);
    });

    it('should return true for late evening', () => {
      jest.setSystemTime(new Date('2024-01-15T23:00:00.000Z'));
      expect(isNightTimeUTC()).toBe(true);
    });

    it('should return false for morning hours', () => {
      jest.setSystemTime(new Date('2024-01-15T08:00:00.000Z'));
      expect(isNightTimeUTC()).toBe(false);
    });

    it('should handle edge cases', () => {
      jest.setSystemTime(new Date('2024-01-15T06:00:00.000Z'));
      expect(isNightTimeUTC()).toBe(false);

      jest.setSystemTime(new Date('2024-01-15T22:00:00.000Z'));
      expect(isNightTimeUTC()).toBe(false);

      jest.setSystemTime(new Date('2024-01-15T05:59:59.999Z'));
      expect(isNightTimeUTC()).toBe(true);

      jest.setSystemTime(new Date('2024-01-15T23:00:00.000Z'));
      expect(isNightTimeUTC()).toBe(true);
    });
  });

  describe('isWeekendUTC', () => {
    it('should return false for Monday', () => {
      // Current time is Monday
      expect(isWeekendUTC()).toBe(false);
    });

    it('should return true for Saturday', () => {
      jest.setSystemTime(new Date('2024-01-13T12:00:00.000Z')); // Saturday
      expect(isWeekendUTC()).toBe(true);
    });

    it('should return true for Sunday', () => {
      jest.setSystemTime(new Date('2024-01-14T12:00:00.000Z')); // Sunday
      expect(isWeekendUTC()).toBe(true);
    });

    it('should return false for weekdays', () => {
      const weekdays = [
        '2024-01-15T12:00:00.000Z', // Monday
        '2024-01-16T12:00:00.000Z', // Tuesday
        '2024-01-17T12:00:00.000Z', // Wednesday
        '2024-01-18T12:00:00.000Z', // Thursday
        '2024-01-19T12:00:00.000Z', // Friday
      ];

      weekdays.forEach(date => {
        jest.setSystemTime(new Date(date));
        expect(isWeekendUTC()).toBe(false);
      });
    });
  });

  describe('daysAgoUTC', () => {
    it('should return date N days ago', () => {
      const result = daysAgoUTC(7);
      expect(result.toISOString()).toBe('2024-01-08T14:30:00.000Z');
    });

    it('should handle 0 days', () => {
      const result = daysAgoUTC(0);
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });

    it('should handle 1 day', () => {
      const result = daysAgoUTC(1);
      expect(result.toISOString()).toBe('2024-01-14T14:30:00.000Z');
    });
  });

  describe('hoursAgoUTC', () => {
    it('should return date N hours ago', () => {
      const result = hoursAgoUTC(2);
      expect(result.toISOString()).toBe('2024-01-15T12:30:00.000Z');
    });

    it('should handle 0 hours', () => {
      const result = hoursAgoUTC(0);
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });

    it('should handle 24 hours', () => {
      const result = hoursAgoUTC(24);
      expect(result.toISOString()).toBe('2024-01-14T14:30:00.000Z');
    });
  });

  describe('minutesAgoUTC', () => {
    it('should return date N minutes ago', () => {
      const result = minutesAgoUTC(30);
      expect(result.toISOString()).toBe('2024-01-15T14:00:00.000Z');
    });

    it('should handle 0 minutes', () => {
      const result = minutesAgoUTC(0);
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });

    it('should handle 60 minutes', () => {
      const result = minutesAgoUTC(60);
      expect(result.toISOString()).toBe('2024-01-15T13:30:00.000Z');
    });
  });

  describe('secondsAgoUTC', () => {
    it('should return date N seconds ago', () => {
      const result = secondsAgoUTC(30);
      expect(result.toISOString()).toBe('2024-01-15T14:29:30.000Z');
    });

    it('should handle 0 seconds', () => {
      const result = secondsAgoUTC(0);
      expect(result.toISOString()).toBe('2024-01-15T14:30:00.000Z');
    });

    it('should handle 3600 seconds (1 hour)', () => {
      const result = secondsAgoUTC(3600);
      expect(result.toISOString()).toBe('2024-01-15T13:30:00.000Z');
    });
  });

  describe('timezone independence', () => {
    it('should return consistent results regardless of system timezone', () => {
      // Mock different timezone scenarios
      const originalTZ = process.env.TZ;

      try {
        // Simulate different timezones
        process.env.TZ = 'America/New_York';
        const nyResult = getCurrentHourUTC();

        process.env.TZ = 'Asia/Tokyo';
        const tokyoResult = getCurrentHourUTC();

        process.env.TZ = 'Europe/London';
        const londonResult = getCurrentHourUTC();

        // All should return the same UTC hour
        expect(nyResult).toBe(14);
        expect(tokyoResult).toBe(14);
        expect(londonResult).toBe(14);
      } finally {
        process.env.TZ = originalTZ;
      }
    });
  });
});
