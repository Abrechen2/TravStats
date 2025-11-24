import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for public airport search endpoints
 * Allows 100 requests per 15 minutes per IP
 */
export const airportSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many airport search requests, please try again later',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

/**
 * Rate limiter for flight creation
 * Allows 20 flight creations per hour per IP
 */
export const flightCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 flight creations per hour
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
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // Limit each IP to 1000 requests per hour
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login/register attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins towards limit
});

/**
 * Rate limiter for flight lookup API endpoints
 * Protects external API keys from abuse (AirLabs, OpenSky)
 * Allows 30 lookups per 15 minutes per IP
 */
export const flightLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 flight lookups per 15 minutes
  message: 'Too many flight lookup requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
