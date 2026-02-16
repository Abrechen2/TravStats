/**
 * Simple logging utility for frontend
 * In production, only errors are logged to console
 * In development, all logs are shown
 */

const isDevelopment = import.meta.env?.DEV ?? import.meta.env?.MODE === 'development';

export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(...args);
    }
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};
