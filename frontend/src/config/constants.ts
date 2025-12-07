/**
 * Frontend application configuration constants
 */

// ========== API TIME OUTS ==========
export const API_TIMEOUTS = {
  DEFAULT: 10000, // 10 seconds
  PARSER: 180000, // 3 minutes for parser operations (Ollama can be slow)
} as const;

// ========== BOARDING PASS OCR ==========
export const BOARDING_PASS_OCR = {
  DEFAULT_TIMEOUT_MS: 10000, // 10 seconds
} as const;


