/**
 * UTC time utilities to ensure timezone-safe operations
 * All functions return UTC dates to avoid timezone issues
 */

/**
 * Get current UTC time as Date object
 * @returns {Date} Current UTC time
 */
export function nowUTC() {
  return new Date();
}

/**
 * Get current UTC timestamp in milliseconds
 * @returns {number} UTC timestamp
 */
export function timestampUTC() {
  return Date.now();
}

/**
 * Get current UTC hour (0-23)
 * @returns {number} UTC hour
 */
export function getCurrentHourUTC() {
  return new Date().getUTCHours();
}

/**
 * Get current UTC day of week (0=Sunday, 6=Saturday)
 * @returns {number} UTC day of week
 */
export function getCurrentDayUTC() {
  return new Date().getUTCDay();
}

/**
 * Create UTC Date from timestamp
 * @param {number} timestamp - Timestamp in milliseconds
 * @returns {Date} UTC Date object
 */
export function dateFromTimestamp(timestamp) {
  return new Date(timestamp);
}

/**
 * Parse ISO string to UTC Date
 * @param {string} isoString - ISO date string
 * @returns {Date} UTC Date object
 */
export function parseISOString(isoString) {
  return new Date(isoString);
}

/**
 * Get current UTC ISO string
 * @returns {string} UTC ISO string
 */
export function toISOStringUTC() {
  return new Date().toISOString();
}

/**
 * Convert Date to UTC ISO string
 * @param {Date} date - Date to convert
 * @returns {string} UTC ISO string
 */
export function dateToISOString(date) {
  return date.toISOString();
}

/**
 * Check if current time is night in UTC (before 6 AM or after 10 PM)
 * @returns {boolean} True if night time in UTC
 */
export function isNightTimeUTC() {
  const hour = getCurrentHourUTC();
  return hour < 6 || hour > 22;
}

/**
 * Check if current day is weekend in UTC
 * @returns {boolean} True if weekend in UTC
 */
export function isWeekendUTC() {
  return [0, 6].includes(getCurrentDayUTC());
}

/**
 * Get UTC time N days ago
 * @param {number} days - Number of days ago
 * @returns {Date} UTC Date N days ago
 */
export function daysAgoUTC(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

/**
 * Get UTC time N hours ago
 * @param {number} hours - Number of hours ago
 * @returns {Date} UTC Date N hours ago
 */
export function hoursAgoUTC(hours) {
  return new Date(timestampUTC() - hours * 60 * 60 * 1000);
}

/**
 * Get UTC time N minutes ago
 * @param {number} minutes - Number of minutes ago
 * @returns {Date} UTC Date N minutes ago
 */
export function minutesAgoUTC(minutes) {
  return new Date(timestampUTC() - minutes * 60 * 1000);
}

/**
 * Get UTC time N seconds ago
 * @param {number} seconds - Number of seconds ago
 * @returns {Date} UTC Date N seconds ago
 */
export function secondsAgoUTC(seconds) {
  return new Date(timestampUTC() - seconds * 1000);
}
