/**
 * Frontend application configuration constants
 */

// ========== API TIME OUTS ==========
export const API_TIMEOUTS = {
  DEFAULT: 10000, // 10 seconds
  PARSER: 180000, // 3 minutes for parser operations (Ollama can be slow)
  /**
   * The train-number lookup: the server bounds one lookup at 20 s over all
   * providers (`RAIL_LOOKUP_BUDGET_MS` in backend/src/services/rail/lookup/
   * railHttp.ts) and then answers which provider it cut short. The client
   * waits a little longer, so that answer arrives instead of a timeout.
   */
  RAIL_LOOKUP: 25000,
} as const;

// ========== BOARDING PASS OCR ==========
export const BOARDING_PASS_OCR = {
  DEFAULT_TIMEOUT_MS: 10000, // 10 seconds
} as const;
