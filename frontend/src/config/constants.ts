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
  // The flight lookup walks up to four providers in turn (Aviationstack 2x6 s,
  // AeroDataBox 8 s, AirLabs 5 s, OpenSky 5+6 s) plus airport resolution — about
  // 36 s in the worst case. The 10 s default gave up first and told the user
  // the search was unavailable while the server was still answering.
  FLIGHT_LOOKUP: 60000,
  // Open data calls that cover the server's own budget (2026-09-26). The
  // default ten seconds is shorter than Overpass's 20-25 s and than an
  // Open-Meteo call plus the database, so the browser gave up first and the UI
  // said "OpenStreetMap does not know this house" about a server still asking.
  /** Server: one Open-Meteo request, 8 s. */
  OPEN_DATA_WEATHER: 20000,
  /** Server: Overpass up to 25 s (nearby) or 20 s plus the OSM API (enrich). */
  OPEN_DATA_OVERPASS: 45000,
  /**
   * The admin zone re-resolution dry run (ADR 0002 D2) re-runs the zone
   * resolver over every stored place-bound time value and answers in one
   * request. The server's own bound belongs to the backend half of Phase 3b;
   * two minutes covers a large instance, where the default ten seconds would
   * report a failure for a scan still running.
   */
  ZONE_RE_RESOLVE_DRY_RUN: 120000,
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
