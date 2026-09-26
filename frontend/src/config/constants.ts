/**
 * Frontend application configuration constants
 */

// ========== API TIME OUTS ==========
export const API_TIMEOUTS = {
  DEFAULT: 10000, // 10 seconds
  PARSER: 180000, // 3 minutes for parser operations (Ollama can be slow)
  // The flight lookup walks up to four providers in turn (Aviationstack 2x6 s,
  // AeroDataBox 8 s, AirLabs 5 s, OpenSky 5+6 s) plus airport resolution — about
  // 36 s in the worst case. The 10 s default gave up first and told the user
  // the search was unavailable while the server was still answering.
  FLIGHT_LOOKUP: 60000,
} as const;

// ========== BOARDING PASS OCR ==========
export const BOARDING_PASS_OCR = {
  DEFAULT_TIMEOUT_MS: 10000, // 10 seconds
} as const;
