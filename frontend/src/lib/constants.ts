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
 * Storage Keys for localStorage
 */
export const STORAGE_KEYS = {
  THEME: "theme",
  USER_SETTINGS: "user-settings",
  CONTEXTUAL_HINTS: "contextual-hints",
} as const;
