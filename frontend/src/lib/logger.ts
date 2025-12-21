/**
 * Simple logging utility for frontend
 * In production, only errors are logged to console
 * In development, all logs are shown
 */

const isDevelopment = import.meta.env?.DEV ?? import.meta.env?.MODE === 'development';

export const logger = {
  debug: (...args: any[]) => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },
  info: (...args: any[]) => {
    if (isDevelopment) {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    console.warn(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
    // In production, you might want to send errors to an error tracking service
    // e.g., Sentry, LogRocket, etc.
  },
};
















