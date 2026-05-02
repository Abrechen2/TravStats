import { Prisma } from "@prisma/client";

// ---- Interfaces for settings data stored as JSON ----

export interface SettingsDataJson {
  profile?: {
    username?: string;
    email?: string;
    profilePicture?: string | null;
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
}

export interface ParserSettingsUpdateData {
  visionProvider?: string;
  textProvider?: string;
}

export interface ApiKeysUpdateData {
  airlabsApiKey?: string | null;
  aviationstackApiKey?: string | null;
  openskyClientId?: string | null;
  openskyClientSecret?: string | null;
  openskyUsername?: string | null;
  openskyPassword?: string | null;
}

export interface UserApiKeySettings {
  airlabsApiKey: string | null;
  aviationstackApiKey: string | null;
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
    seatClass: "economy",
    favoriteAirline: "Lufthansa",
    flightCategory: "business",
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
