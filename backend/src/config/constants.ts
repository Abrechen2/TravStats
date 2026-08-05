/**
 * Application configuration constants
 * All hardcoded values should be moved here for easier maintenance
 */

// ========== TIME OUTS ==========
export const TIMEOUTS = {
  // API timeouts (in milliseconds)
  API_DEFAULT: 10000, // 10 seconds
  API_PARSER: 180000, // 3 minutes for parser operations (Ollama can be slow)

  // LLM/Parser timeouts
  LLM_TEXT: 60000, // 60 seconds for text parsing
  LLM_TEXT_COMPLEX: 90000, // 90 seconds for complex emails
  LLM_VISION: 60000, // 60 seconds for vision parsing
  LLM_MODEL_DOWNLOAD: 600000, // 10 minutes for model downloads
  LLM_HEALTH_CHECK: 3000, // 3 seconds for health checks
  LLM_AVAILABILITY_CHECK: 5000, // 5 seconds for availability checks

  // External API timeouts
  FLIGHT_LOOKUP: 5000, // 5 seconds for flight lookup APIs
  FLIGHT_LOOKUP_BULK: 6000, // 6 seconds for bulk flight lookups
  AIRPORT_LOOKUP: 5000, // 5 seconds for airport lookups
} as const;

// ========== FILE UPLOAD LIMITS ==========
export const FILE_LIMITS = {
  // File size limits (in bytes)
  RECEIPT_MAX_SIZE: 10 * 1024 * 1024, // 10 MB
  EMAIL_MAX_SIZE: 5 * 1024 * 1024, // 5 MB
  BOARDING_PASS_MAX_SIZE: 10 * 1024 * 1024, // 10 MB (for base64 images)
  PDF_MAX_SIZE: 20 * 1024 * 1024, // 20 MB
  TRIP_PHOTO_MAX_SIZE: 15 * 1024 * 1024, // 15 MB per photo
  TRIP_PHOTO_MAX_COUNT: 20, // per upload request
  // Per-asset ceiling for Immich album import. Deliberately far above
  // TRIP_PHOTO_MAX_SIZE: imported originals (RAWs, long videos-as-images,
  // panoramas) are legitimately large, but a single asset must not be able to
  // fill the data volume. An asset over this is skipped and counted as a
  // failed asset, never aborting the whole import.
  IMMICH_MAX_ASSET_BYTES: 100 * 1024 * 1024, // 100 MB per imported asset
  // Matches the client-side check in useSettingsPage.ts (handleAvatarUpload)
  // — the client check alone is not a security control, this is the real cap.
  PROFILE_PICTURE_MAX_SIZE: 5 * 1024 * 1024, // 5 MB

  // Body parsing limits
  JSON_BODY_MAX_SIZE: '10mb',
  URLENCODED_BODY_MAX_SIZE: '10mb',

  // Text processing limits
  EMAIL_TEXT_MAX_LENGTH: 4000, // characters for basic parser
  EMAIL_TEXT_MAX_LENGTH_ENHANCED: 6000, // characters for enhanced parser
} as const;

// ========== RATE LIMITING ==========
export const RATE_LIMITS = {
  // General API rate limits
  GENERAL_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  GENERAL_MAX_REQUESTS: 10000, // per window in production
  GENERAL_MAX_REQUESTS_DEV: Number.MAX_SAFE_INTEGER, // unlimited in dev

  // Authentication rate limits
  AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  AUTH_MAX_ATTEMPTS: 10, // login/register attempts per window

  // Flight creation rate limits
  FLIGHT_CREATION_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  FLIGHT_CREATION_MAX: 20, // flight creations per hour

  // Flight lookup rate limits
  FLIGHT_LOOKUP_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  FLIGHT_LOOKUP_MAX: 30, // lookups per window

  // Airport search rate limits
  AIRPORT_SEARCH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  AIRPORT_SEARCH_MAX: 100, // searches per window

  // Backup restore rate limits
  BACKUP_RESTORE_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  BACKUP_RESTORE_MAX: 3, // 3 restores per hour

  // Boarding pass parse rate limits
  BOARDING_PASS_PARSE_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  BOARDING_PASS_PARSE_MAX: 20, // parses per window

  // Stats calculation rate limits (expensive DB aggregations)
  STATS_WINDOW_MS: 60 * 1000, // 1 minute
  STATS_MAX_REQUESTS: 30, // 30 requests per minute

  // Admin export rate limits (loads entire DB)
  ADMIN_EXPORT_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  ADMIN_EXPORT_MAX: 5, // 5 exports per hour

  // Admin airport reseed rate limits (18k row upsert, expensive)
  ADMIN_RESEED_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  ADMIN_RESEED_MAX: 3, // 3 reseeds per hour per admin (DoS guard)

  // PDF parse rate limits
  PDF_PARSE_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  PDF_PARSE_MAX: 20, // 20 requests per window

  // Receipt upload rate limits (prevent disk exhaustion)
  UPLOAD_RECEIPT_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  UPLOAD_RECEIPT_MAX: 30, // 30 uploads per hour

  // Profile picture upload rate limits (prevent disk exhaustion)
  UPLOAD_PROFILE_PICTURE_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  UPLOAD_PROFILE_PICTURE_MAX: 20, // 20 uploads per hour per user

  // /settings is authenticated and per-user — no rate limiter is mounted.
  // These constants are kept for the limiter export so other code can still
  // reference them, but the middleware is intentionally not wired up.
  SETTINGS_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  SETTINGS_MAX_REQUESTS: 5000, // 5000 requests per 15 minutes

  // Password reset rate limits
  PASSWORD_RESET_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  PASSWORD_RESET_MAX: 5,

  // Diagnostic export rate limits (reads log files from disk)
  // Cheap to build but meant for human bug-report workflows, not scripts.
  DIAGNOSTIC_EXPORT_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  DIAGNOSTIC_EXPORT_MAX: 10, // 10 per hour per user

  // Immich: a single gallery render can request hundreds of tiles, so the
  // proxy budget is deliberately generous. Imports are the opposite — rare,
  // heavy, and worth throttling hard.
  IMMICH_PROXY_WINDOW_MS: 60 * 1000,
  IMMICH_PROXY_MAX: 600,
  IMMICH_IMPORT_WINDOW_MS: 15 * 60 * 1000,
  IMMICH_IMPORT_MAX: 20,
} as const;

// ========== DATABASE & QUERY LIMITS ==========
export const QUERY_LIMITS = {
  // Default pagination
  DEFAULT_LIMIT: 100,
  MAX_LIMIT: 500,

  // Search limits
  SEARCH_DEFAULT_LIMIT: 100,
  SEARCH_MAX_LIMIT: 1000,
  SEARCH_MAX_FILES: 10, // max files to search in log search

  // Stats limits
  STATS_TOP_LIMIT: 10, // default top N for stats
  STATS_MAX_LIMIT: 100, // max top N for stats

  // Achievement limits
  ACHIEVEMENT_DEFAULT_LIMIT: 10,
  ACHIEVEMENT_MAX_LIMIT: 100,
} as const;

// ========== CACHE SETTINGS ==========
export const CACHE_TTL = {
  // Logging config cache
  LOGGING_CONFIG: 5 * 60 * 1000, // 5 minutes

  // Airport cache
  AIRPORT_CACHE: 60 * 60, // 1 hour (in seconds for node-cache)
  AIRPORT_CACHE_NULL: 5 * 60, // 5 minutes for null results

  // CSV cache (OurAirports)
  CSV_CACHE: 24 * 60 * 60 * 1000, // 24 hours
} as const;

// ========== SECURITY SETTINGS ==========
export const SECURITY = {
  // Encryption
  PBKDF2_ITERATIONS: 100000, // PBKDF2 iterations for key derivation

  // JWT
  JWT_SECRET_MIN_LENGTH: 32, // minimum length for JWT secret

  // File validation
  MAGIC_NUMBER_READ_BYTES: 32, // bytes to read for magic number validation
  MAGIC_NUMBER_READ_BYTES_TEXT: 512, // bytes to read for text file validation
} as const;

// ========== ACHIEVEMENT REQUIREMENTS ==========
export const ACHIEVEMENT_REQUIREMENTS = {
  DISTANCE_10000: 10000, // km
  DISTANCE_100000: 100000, // km
  LONG_HAUL_10000: 10000, // km for long-haul flights
} as const;

// ========== LOGGING DEFAULTS ==========
export const LOGGING_DEFAULTS = {
  MAX_LOG_FILE_SIZE_MB: 10,
  MAX_LOG_FILES: 7,
  LOG_RETENTION_DAYS: 7,
} as const;

// ========== USER LIMITS ==========
export const USER_LIMITS = {
  MAX_USERS_WARNING_THRESHOLD: 6, // warn when approaching this many users
  MAX_USERS: 10, // maximum number of users (can be overridden by admin)
} as const;

// ========== PARSER SETTINGS ==========
export const PARSER_SETTINGS = {
  // LLM temperature settings
  LLM_TEMPERATURE_LOW: 0.05, // for consistent extraction
  LLM_TEMPERATURE_FACTUAL: 0.1, // for factual extraction

  // LLM token limits
  LLM_NUM_PREDICT_TEXT: 2000, // tokens for text parsing
  LLM_NUM_PREDICT_VISION: 1200, // tokens for vision parsing
  LLM_NUM_PREDICT_VISION_LEGACY: 500, // tokens for legacy vision parser

  // LLM other settings
  LLM_TOP_P: 0.9,
  LLM_TOP_K: 40,
  LLM_REPEAT_PENALTY: 1.1,
} as const;

// ========== FILE CLEANUP ==========
export const CLEANUP = {
  RECEIPT_RETENTION_DAYS: 90, // days before cleaning up orphaned receipts
} as const;

// ========== AIRPORT CATALOGUE ==========
export const AIRPORT_CATALOGUE = {
  /**
   * Below this row count the catalogue is treated as never having finished
   * seeding, and the OurAirports import is (re-)started.
   *
   * A complete import lands ~18,000 rows. The guards used to ask only whether
   * ANY airport existed, so a run interrupted partway left a fragment that
   * counted as "seeded" and was never retried — measured in the wild at 57
   * rows. Every airport outside the fragment then resolves no timezone and no
   * country, which silently degrades displayed times, "countries visited" and
   * the country achievements. 1,000 sits far below any complete import and far
   * above any plausible fragment.
   */
  MIN_HEALTHY_COUNT: 1000,
} as const;
