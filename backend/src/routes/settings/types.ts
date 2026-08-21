import { Prisma } from "@prisma/client";

// ---- Interfaces for settings data stored as JSON ----

export interface SettingsDataJson {
  profile?: {
    username?: string;
    email?: string;
    profilePicture?: string | null;
    // Merged in from the `User` row rather than stored in this JSON — see
    // buildSettingsResponse (#241).
    firstName?: string | null;
    lastName?: string | null;
  };
  display?: {
    theme?: string;
    language?: string;
    timezone?: string;
    dateFormat?: string;
    timeFormat?: string;
  };
  units?: {
    distanceUnit?: string;
    currency?: string;
  };
  defaults?: {
    flightStatus?: string;
    seatClass?: string;
    favoriteAirline?: string;
    flightCategory?: string;
  };
  map?: {
    mapStyle?: string;
    zoomLevel?: number;
    markerStyle?: string;
    routeColor?: string;
  };
  notifications?: {
    emailNotifications?: boolean;
    flightReminder?: string;
    checkInReminder?: boolean;
    featureUpdates?: boolean;
  };
  /** Chronological list of home airports. See backend/src/utils/homeAirport.ts. */
  homeAirportHistory?: Array<{
    iata: string;
    fromDate: string; // YYYY-MM-DD
    toDate: string | null; // YYYY-MM-DD, null = currently active
  }>;
  whatsNewSeenVersion?: string;
  [key: string]: unknown;
}

export interface AutoUpdateResponseSettings {
  enabled: boolean;
  requireApproval: boolean;
  checkInterval: number;
  onlyDuringFlight: boolean;
  expiryHours: number;
}

export interface HistoricalEnrichmentResponseSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

export interface SettingsResponse extends SettingsDataJson {
  autoUpdate: AutoUpdateResponseSettings;
  boardingPassParserStrategy: string | null;
  historicalEnrichment: HistoricalEnrichmentResponseSettings;
  enabledDomains: string[];
  baseCurrency: string;
  /** Silent trip auto-creation during flight import (column-backed). */
  autoCreateTrips: boolean;
  /**
   * READ-ONLY mirror of the instance-level beta gate (AdminSettings row).
   * It is NOT part of the user's own settings and deliberately absent from
   * `settingsSchema`, so a PUT /settings carrying it is silently stripped by
   * Zod — only an admin can change it, via PUT /admin/instance-settings.
   */
  betaFeaturesEnabled: boolean;
}

export interface UserSettingsUpdateData {
  data?: Prisma.InputJsonValue;
  autoUpdateEnabled?: boolean;
  autoUpdateRequireApproval?: boolean;
  autoUpdateCheckInterval?: number;
  autoUpdateOnlyDuringFlight?: boolean;
  autoUpdateExpiryHours?: number;
  historicalEnrichmentEnabled?: boolean;
  historicalEnrichmentMinConfidence?: number;
  historicalEnrichmentMaxPerDay?: number;
  boardingPassParserStrategy?: string | null;
  enabledDomains?: string[];
  baseCurrency?: string;
  autoCreateTrips?: boolean;
}

export interface ParserSettingsUpdateData {
  visionProvider?: string;
  textProvider?: string;
}

export interface ApiKeysUpdateData {
  airlabsApiKey?: string | null;
  aviationstackApiKey?: string | null;
  aerodataboxApiKey?: string | null;
  openskyClientId?: string | null;
  openskyClientSecret?: string | null;
  openskyUsername?: string | null;
  openskyPassword?: string | null;
}

export interface UserApiKeySettings {
  airlabsApiKey: string | null;
  aviationstackApiKey: string | null;
  aerodataboxApiKey: string | null;
  openskyClientId: string | null;
  openskyClientSecret: string | null;
  openskyUsername: string | null;
  openskyPassword: string | null;
}

export interface PrismaErrorWithCode extends Error {
  code?: string;
}

// Shared default settings used across sub-routers.
//
// `display.language`, `display.timezone`, and `display.dateFormat` are
// intentionally absent: when no UserSettings row exists yet for a fresh
// account, we want the frontend's browser detection to win (issue #87).
// Hardcoding `de` / `Europe/Berlin` / `DD.MM.YYYY` here used to clobber
// the locally-detected `en` the moment `loadRemoteSettings()` fired
// post-login, flipping every English-locale user's UI to German on first
// login. The frontend Zustand store still has its own browser-detected
// fallback for these three fields, so omitting them here means the
// backend response merges in without overwriting them.
export const defaultSettings = {
  profile: {
    username: "Traveler",
    email: "traveler@example.com",
    profilePicture: null,
  },
  display: { theme: "light", timeFormat: "24h" },
  units: { distanceUnit: "kilometers", currency: "EUR" },
  defaults: {
    flightStatus: "scheduled",
    // "" = no default: the flight form must not classify an untouched
    // flight (#256). Mirrors frontend settingsStore.ts.
    seatClass: "",
    favoriteAirline: "Lufthansa",
    flightCategory: "",
  },
  map: {
    mapStyle: "osm",
    zoomLevel: 3,
    markerStyle: "pin",
    routeColor: "#2563eb",
  },
  notifications: {
    emailNotifications: true,
    flightReminder: "24h",
    checkInReminder: true,
    featureUpdates: true,
  },
};
