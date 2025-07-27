/**
 * Example code demonstrating timezone safety ESLint rules
 * This file contains both problematic and correct patterns for educational purposes
 * Run `npx eslint tests/fixtures/timezone-examples.js` to see rule violations
 */

// ❌ PROBLEMATIC PATTERNS (these will trigger ESLint errors)

export const badExamples = {
  // Local timezone methods (should use UTC equivalents)
  localTimeMethods: () => {
    const now = new Date();
    const hour = now.getHours(); // ❌ Should use getUTCHours()
    const day = now.getDay(); // ❌ Should use getUTCDay()
    const minutes = now.getMinutes(); // ❌ Should use getUTCMinutes()
    return { hour, day, minutes };
  },

  // Local timezone setters
  localTimeSetters: () => {
    const date = new Date();
    date.setHours(14); // ❌ Should use setUTCHours()
    date.setDate(15); // ❌ Should use setUTCDate()
    return date;
  },

  // Locale-dependent string formatting
  localeFormatting: () => {
    const date = new Date();
    return {
      locale: date.toLocaleString(), // ❌ Should use toISOString()
      localeDate: date.toLocaleDateString(), // ❌ Should use toISOString()
      localeTime: date.toLocaleTimeString(), // ❌ Should use toISOString()
    };
  },

  // Direct Date objects in timestamp contexts
  timestampStorage: () => {
    return {
      timestamp: new Date(), // ❌ Should use nowUTC()
      createdAt: new Date(), // ❌ Should use nowUTC()
      updatedAt: new Date(), // ❌ Should use nowUTC()
      startTime: new Date(), // ❌ Should use nowUTC()
      time: new Date(), // ❌ Should use nowUTC()
    };
  },

  // Problematic logging
  problematicLogging: () => {
    const date = new Date();
    console.log('Current time:', date.toLocaleString()); // ❌ Should use toISOString()
    console.info('Timestamp:', date.toLocaleDateString()); // ❌ Should use toISOString()
  },
};

// ✅ CORRECT PATTERNS (these follow timezone safety best practices)

import {
  nowUTC,
  getCurrentHourUTC,
  getCurrentDayUTC,
  toISOStringUTC,
  daysAgoUTC,
} from '../../src/utilities/utc-time.js';

export const goodExamples = {
  // UTC methods for time components
  utcTimeMethods: () => {
    const now = new Date();
    const hour = now.getUTCHours(); // ✅ UTC method
    const day = now.getUTCDay(); // ✅ UTC method
    const minutes = now.getUTCMinutes(); // ✅ UTC method
    return { hour, day, minutes };
  },

  // UTC utility functions (preferred)
  utcUtilities: () => {
    const hour = getCurrentHourUTC(); // ✅ UTC utility
    const day = getCurrentDayUTC(); // ✅ UTC utility
    const timestamp = toISOStringUTC(); // ✅ UTC utility
    return { hour, day, timestamp };
  },

  // UTC setters
  utcTimeSetters: () => {
    const date = new Date();
    date.setUTCHours(14); // ✅ UTC setter
    date.setUTCDate(15); // ✅ UTC setter
    return date;
  },

  // UTC string formatting
  utcFormatting: () => {
    const date = new Date();
    return {
      iso: date.toISOString(), // ✅ UTC ISO string
      utc: date.toUTCString(), // ✅ UTC string
      timestamp: toISOStringUTC(), // ✅ UTC utility
    };
  },

  // Proper timestamp storage
  properTimestampStorage: () => {
    return {
      timestamp: nowUTC(), // ✅ UTC utility
      createdAt: nowUTC(), // ✅ UTC utility
      updatedAt: new Date().toISOString(), // ✅ UTC ISO string
      startTime: nowUTC(), // ✅ UTC utility
      isoTime: toISOStringUTC(), // ✅ UTC utility
    };
  },

  // Proper logging
  properLogging: () => {
    const timestamp = toISOStringUTC();
    console.log('Current time:', timestamp); // ✅ UTC timestamp
    console.info('ISO string:', new Date().toISOString()); // ✅ UTC ISO
  },

  // Time arithmetic
  timeArithmetic: () => {
    const yesterday = daysAgoUTC(1); // ✅ UTC utility
    const weekAgo = daysAgoUTC(7); // ✅ UTC utility
    return { yesterday, weekAgo };
  },

  // Numeric timestamps (these are inherently UTC)
  numericTimestamps: () => {
    const now = timestampUTC(); // ✅ Always UTC milliseconds
    const timestamp = new Date().getTime(); // ✅ Always UTC milliseconds
    return { now, timestamp };
  },
};

// 📚 EDUCATIONAL EXAMPLES

export const educationalExamples = {
  // Showing the difference between local and UTC
  timezoneDifference: () => {
    const date = new Date();

    return {
      // These could be different depending on server timezone:
      localHour: date.getHours(), // ❌ Varies by timezone
      localDay: date.getDay(), // ❌ Could be different day

      // These are always consistent:
      utcHour: date.getUTCHours(), // ✅ Always UTC
      utcDay: date.getUTCDay(), // ✅ Always UTC

      // For comparison:
      timezoneOffset: date.getTimezoneOffset(), // Shows local offset from UTC
    };
  },

  // Business logic example
  businessLogicExample: () => {
    // ❌ Bad: Could behave differently on servers in different timezones
    const badNightCheck = () => {
      const hour = new Date().getHours();
      return hour < 6 || hour > 22;
    };

    // ✅ Good: Consistent behavior regardless of server timezone
    const goodNightCheck = () => {
      const hour = getCurrentHourUTC();
      return hour < 6 || hour > 22;
    };

    return { badNightCheck, goodNightCheck };
  },
};
