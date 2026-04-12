import { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { RATE_LIMITS } from '../config/constants';

/**
 * Key generator that uses userId (from JWT auth) when available,
 * falling back to IP. This prevents bypass via multiple IPs for
 * the same authenticated user.
 */
const userOrIpKey = (req: Request): string => {
  const userId = (req as { userId?: string }).userId;
  return userId ?? req.ip ?? 'unknown';
};

/**
 * Rate limiter for public airport search endpoints
 * Allows 100 requests per 15 minutes per IP
 */
export const airportSearchLimiter = rateLimit({
  windowMs: RATE_LIMITS.AIRPORT_SEARCH_WINDOW_MS,
  max: RATE_LIMITS.AIRPORT_SEARCH_MAX,
  message: 'Too many airport search requests, please try again later',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

/**
 * Rate limiter for flight creation
 * Allows 20 flight creations per hour per IP
 */
export const flightCreationLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_CREATION_WINDOW_MS,
  max: RATE_LIMITS.FLIGHT_CREATION_MAX,
  message: 'Too many flights created, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for successful requests (only count failed/repeated attempts)
  skipSuccessfulRequests: false,
});

/**
 * General API rate limiter
 * Allows 1000 requests per hour per IP
 */
export const generalLimiter = rateLimit({
  windowMs: RATE_LIMITS.GENERAL_WINDOW_MS,
  max: RATE_LIMITS.GENERAL_MAX_REQUESTS,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for authentication endpoints (login, register)
 * Protects against brute-force attacks and mass registration
 * Allows 10 attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.AUTH_WINDOW_MS,
  max: RATE_LIMITS.AUTH_MAX_ATTEMPTS,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // All attempts count — skipSuccessfulRequests was removed to prevent brute-force bypass
});

/**
 * Rate limiter for flight lookup API endpoints
 * Protects external API keys from abuse (AirLabs, OpenSky)
 * Allows 30 lookups per 15 minutes per IP
 */
export const flightLookupLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_LOOKUP_WINDOW_MS,
  max: RATE_LIMITS.FLIGHT_LOOKUP_MAX,
  message: 'Too many flight lookup requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for analytics events
 * Protects against DoS attacks via large payloads
 * Allows 100 requests per 15 minutes per IP
 */
export const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many analytics requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for backup restore operations
 * Prevents accidental data loss through rapid restores
 * Allows 3 restores per hour per IP
 */
export const backupRestoreLimiter = rateLimit({
  windowMs: RATE_LIMITS.BACKUP_RESTORE_WINDOW_MS,
  max: RATE_LIMITS.BACKUP_RESTORE_MAX,
  message: 'Too many restore operations, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for boarding pass parsing (expensive LLM/vision operation)
 * Allows 20 parses per 15 minutes per IP
 */
export const boardingPassParseLimiter = rateLimit({
  windowMs: RATE_LIMITS.BOARDING_PASS_PARSE_WINDOW_MS,
  max: RATE_LIMITS.BOARDING_PASS_PARSE_MAX,
  message: 'Too many boarding pass parse requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for email parsing (triggers expensive LLM operations)
 * Allows 10 parses per 15 minutes per IP
 */
export const emailParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many parse requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for stats calculation endpoints (expensive DB aggregations)
 * Allows 30 requests per minute per IP
 */
export const statsLimiter = rateLimit({
  windowMs: RATE_LIMITS.STATS_WINDOW_MS,
  max: RATE_LIMITS.STATS_MAX_REQUESTS,
  message: 'Too many stats requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for admin export endpoint (loads entire database)
 * Allows 5 exports per hour per IP
 */
export const adminExportLimiter = rateLimit({
  windowMs: RATE_LIMITS.ADMIN_EXPORT_WINDOW_MS,
  max: RATE_LIMITS.ADMIN_EXPORT_MAX,
  message: 'Too many export requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for PDF parse endpoint
 * Allows 20 requests per 15 minutes per user
 */
export const pdfParseLimiter = rateLimit({
  windowMs: RATE_LIMITS.PDF_PARSE_WINDOW_MS,
  max: RATE_LIMITS.PDF_PARSE_MAX,
  message: 'Too many PDF parse requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for batch flight creation
 * More restrictive than single-flight limiter: 1 batch = up to 20 flights.
 * Allows 10 batch requests per hour (max ~200 flights per hour).
 */
export const batchCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 batch requests per hour
  message: 'Too many batch requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for receipt file uploads
 * Prevents disk exhaustion through repeated uploads
 * Allows 30 uploads per hour per IP
 */
export const uploadReceiptLimiter = rateLimit({
  windowMs: RATE_LIMITS.UPLOAD_RECEIPT_WINDOW_MS,
  max: RATE_LIMITS.UPLOAD_RECEIPT_MAX,
  message: 'Too many file uploads, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for settings endpoints
 * Prevents enumeration and brute-force of settings values
 * Allows 60 requests per 15 minutes per IP
 */
export const settingsLimiter = rateLimit({
  windowMs: RATE_LIMITS.SETTINGS_WINDOW_MS,
  max: RATE_LIMITS.SETTINGS_MAX_REQUESTS,
  message: 'Too many settings requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for password reset endpoints
 * Prevents brute-force on reset token endpoints
 * Allows 5 attempts per 15 minutes per IP
 */
export const passwordResetLimiter = rateLimit({
  windowMs: RATE_LIMITS.PASSWORD_RESET_WINDOW_MS,
  max: RATE_LIMITS.PASSWORD_RESET_MAX,
  message: 'Too many password reset attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
