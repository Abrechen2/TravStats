/**
 * Frontend application configuration constants
 */

// ========== API TIME OUTS ==========
export const API_TIMEOUTS = {
  DEFAULT: 10000, // 10 seconds
  PARSER: 180000, // 3 minutes for parser operations (Ollama can be slow)
} as const;

// ========== CRUISE SEA-ROUTE GEOMETRY ==========
// `POST /cruises/geometry/batch` refuses more than 100 ids (400), and a cold
// batch routes every leg through the marnet A*, which can outlast the 10 s
// default. Both used to end in straight chords without a word.
export const CRUISE_GEOMETRY = {
  BATCH_SIZE: 100, // the server's own cap (routes/cruises.ts, geometryBatchSchema)
  TIMEOUT_MS: 60000, // a cold 100-cruise batch, with room to spare
} as const;

// ========== BOARDING PASS OCR ==========
export const BOARDING_PASS_OCR = {
  DEFAULT_TIMEOUT_MS: 10000, // 10 seconds
} as const;
