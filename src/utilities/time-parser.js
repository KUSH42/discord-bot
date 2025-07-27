/**
 * Utility functions for parsing relative time strings into Date objects
 * All operations are performed in UTC to avoid timezone issues
 */

import { nowUTC } from './utc-time.js';

/**
 * Parse relative time strings (e.g., "1 hour ago", "2 days ago") into Date objects
 * All calculations are performed in UTC to ensure timezone safety
 * @param {string} relativeTimeString - The relative time string to parse
 * @param {Date} [referenceDate] - The reference date to calculate from (defaults to current UTC time)
 * @returns {Date|null} The calculated Date object, or null if parsing fails
 * @example
 * parseRelativeTime("1 hour ago") // Returns Date 1 hour before now (UTC)
 * parseRelativeTime("2 days ago") // Returns Date 2 days before now (UTC)
 * parseRelativeTime("just now") // Returns current Date (UTC)
 */
export function parseRelativeTime(relativeTimeString, referenceDate = nowUTC()) {
  if (!relativeTimeString || typeof relativeTimeString !== 'string') {
    return null;
  }

  const timeString = relativeTimeString.toLowerCase().trim();

  // Handle immediate cases
  if (timeString === 'just now' || timeString === 'now') {
    return new Date(referenceDate);
  }

  // Pattern: number + time unit + "ago" (reject negative numbers)
  const match = timeString.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);

  if (!match) {
    // Try patterns without "ago" (e.g., "1h", "2d")
    const shortMatch = timeString.match(/^(\d+)\s*([smhdwy])$/);
    if (shortMatch) {
      const amount = parseInt(shortMatch[1], 10);
      const unit = shortMatch[2];
      return calculateDateFromShortUnit(amount, unit, referenceDate);
    }

    // If no pattern matches, return null
    return null;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  if (isNaN(amount) || amount < 0) {
    return null;
  }

  return calculateDateFromUnit(amount, unit, referenceDate);
}

/**
 * Calculate date by subtracting time units from reference date
 * @param {number} amount - Amount of time units
 * @param {string} unit - Time unit (second, minute, hour, day, week, month, year)
 * @param {Date} referenceDate - Reference date to calculate from
 * @returns {Date} Calculated date
 */
function calculateDateFromUnit(amount, unit, referenceDate) {
  const date = new Date(referenceDate);

  switch (unit) {
    case 'second':
      date.setUTCSeconds(date.getUTCSeconds() - amount);
      break;
    case 'minute':
      date.setUTCMinutes(date.getUTCMinutes() - amount);
      break;
    case 'hour':
      date.setUTCHours(date.getUTCHours() - amount);
      break;
    case 'day':
      date.setUTCDate(date.getUTCDate() - amount);
      break;
    case 'week':
      date.setUTCDate(date.getUTCDate() - amount * 7);
      break;
    case 'month':
      date.setUTCMonth(date.getUTCMonth() - amount);
      break;
    case 'year':
      date.setUTCFullYear(date.getUTCFullYear() - amount);
      break;
    default:
      return null;
  }

  return date;
}

/**
 * Calculate date from short unit notation (s, m, h, d, w, y)
 * @param {number} amount - Amount of time units
 * @param {string} shortUnit - Short time unit (s, m, h, d, w, y)
 * @param {Date} referenceDate - Reference date to calculate from
 * @returns {Date} Calculated date
 */
function calculateDateFromShortUnit(amount, shortUnit, referenceDate) {
  const unitMap = {
    s: 'second',
    m: 'minute',
    h: 'hour',
    d: 'day',
    w: 'week',
    y: 'year',
  };

  const fullUnit = unitMap[shortUnit];
  if (!fullUnit) {
    return null;
  }

  return calculateDateFromUnit(amount, fullUnit, referenceDate);
}

/**
 * Check if a relative time string is valid and parseable
 * @param {string} relativeTimeString - The relative time string to validate
 * @returns {boolean} True if the string can be parsed
 */
export function isValidRelativeTime(relativeTimeString) {
  return parseRelativeTime(relativeTimeString) !== null;
}
