/**
 * Application-wide constants
 * Centralized configuration for magic numbers and common values
 */

/**
 * API Pagination Limits
 */
export const API_LIMITS = {
  /** Default page size for flight listings */
  DEFAULT_PAGE_SIZE: 100,
  /** Maximum page size allowed by backend */
  MAX_PAGE_SIZE: 500,
  /** Number of flights to show in sidebar (max backend allows) */
  RECENT_FLIGHTS: 500,
  /** Number of top routes to display */
  TOP_ROUTES: 5,
  /** Maximum airlines to show in filter dropdown */
  MAX_FILTER_AIRLINES: 15,
} as const;

/**
 * UI Configuration
 */
export const UI_CONFIG = {
  /** Minimum screen width for XL breakpoint (matches Tailwind xl:) */
  XL_BREAKPOINT: 1280,
} as const;

/**
 * Date & Time Formats
 * Note: LOCALE is now dynamic based on user language setting
 * Use getDateLocale() helper function to get the current locale
 */
export const DATE_FORMATS = {
  /** Default date format options */
  DEFAULT: {
    year: "numeric" as const,
    month: "2-digit" as const,
    day: "2-digit" as const,
    hour: "2-digit" as const,
    minute: "2-digit" as const,
  },
} as const;

/**
 * Get the current date locale based on user language setting
 */
export function getDateLocale(): string {
  try {
    const stored = localStorage.getItem("settings-storage");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.display?.language) {
        return parsed.state.display.language === "de" ? "de-DE" : "en-US";
      }
    }
  } catch {
    // Fallback to default
  }
  return "en-US"; // Default to English
}

/**
 * Export Formats
 */
export const EXPORT_FORMATS = {
  CSV: "csv",
  GEOJSON: "geojson",
  PDF: "pdf",
  KML: "kml",
  JSON: "json",
} as const;

/**
 * Flight Status Values
 */
export const FLIGHT_STATUS = {
  SCHEDULED: "scheduled",
  FLOWN: "flown",
  CANCELLED: "cancelled",
} as const;

/**
 * Common airlines for autocomplete (IATA code → display name)
 * Mirrors the backend AIRLINE_IATA_MAP in flightLookup.ts
 */
export const AIRLINES: { iata: string; name: string }[] = [
  { iata: "4U", name: "Germanwings" },
  { iata: "6E", name: "IndiGo" },
  { iata: "AA", name: "American Airlines" },
  { iata: "AC", name: "Air Canada" },
  { iata: "AF", name: "Air France" },
  { iata: "AI", name: "Air India" },
  { iata: "AM", name: "Aeromexico" },
  { iata: "AR", name: "Aerolíneas Argentinas" },
  { iata: "AS", name: "Alaska Airlines" },
  { iata: "AV", name: "Avianca" },
  { iata: "AY", name: "Finnair" },
  { iata: "B6", name: "JetBlue" },
  { iata: "BA", name: "British Airways" },
  { iata: "BE", name: "Flybe" },
  { iata: "BR", name: "EVA Air" },
  { iata: "BY", name: "TUI Airways" },
  { iata: "CA", name: "Air China" },
  { iata: "CI", name: "China Airlines" },
  { iata: "CM", name: "Copa Airlines" },
  { iata: "CX", name: "Cathay Pacific" },
  { iata: "CZ", name: "China Southern" },
  { iata: "DL", name: "Delta Air Lines" },
  { iata: "DY", name: "Norwegian" },
  { iata: "EI", name: "Aer Lingus" },
  { iata: "EK", name: "Emirates" },
  { iata: "EN", name: "Air Dolomiti" },
  { iata: "ET", name: "Ethiopian Airlines" },
  { iata: "EW", name: "Eurowings" },
  { iata: "EY", name: "Etihad Airways" },
  { iata: "F9", name: "Frontier Airlines" },
  { iata: "FR", name: "Ryanair" },
  { iata: "FZ", name: "flydubai" },
  { iata: "G3", name: "Gol" },
  { iata: "GA", name: "Garuda Indonesia" },
  { iata: "GF", name: "Gulf Air" },
  { iata: "I2", name: "Iberia Express" },
  { iata: "IB", name: "Iberia" },
  { iata: "JL", name: "Japan Airlines" },
  { iata: "KE", name: "Korean Air" },
  { iata: "KL", name: "KLM" },
  { iata: "KQ", name: "Kenya Airways" },
  { iata: "LA", name: "LATAM Airlines" },
  { iata: "LH", name: "Lufthansa" },
  { iata: "LO", name: "LOT Polish Airlines" },
  { iata: "LS", name: "Jet2" },
  { iata: "LX", name: "SWISS" },
  { iata: "MH", name: "Malaysia Airlines" },
  { iata: "MS", name: "EgyptAir" },
  { iata: "MU", name: "China Eastern" },
  { iata: "NH", name: "ANA" },
  { iata: "NK", name: "Spirit Airlines" },
  { iata: "OK", name: "Czech Airlines" },
  { iata: "OS", name: "Austrian Airlines" },
  { iata: "OZ", name: "Asiana Airlines" },
  { iata: "QR", name: "Qatar Airways" },
  { iata: "RO", name: "TAROM" },
  { iata: "SA", name: "South African Airways" },
  { iata: "SK", name: "SAS" },
  { iata: "SN", name: "Brussels Airlines" },
  { iata: "SQ", name: "Singapore Airlines" },
  { iata: "TG", name: "Thai Airways" },
  { iata: "TK", name: "Turkish Airlines" },
  { iata: "TP", name: "TAP Air Portugal" },
  { iata: "U2", name: "easyJet" },
  { iata: "UA", name: "United Airlines" },
  { iata: "UX", name: "Air Europa" },
  { iata: "VY", name: "Vueling" },
  { iata: "W6", name: "Wizz Air" },
  { iata: "WN", name: "Southwest Airlines" },
  { iata: "WS", name: "WestJet" },
  { iata: "WY", name: "Oman Air" },
  { iata: "WZ", name: "Wizz Air" },
  { iata: "X3", name: "TUI fly Deutschland" },
];

/**
 * Storage Keys for localStorage
 */
export const STORAGE_KEYS = {
  ONBOARDING_CHECKLIST: "onboarding-checklist",
  THEME: "theme",
  USER_SETTINGS: "user-settings",
  CONTEXTUAL_HINTS: "contextual-hints",
} as const;
