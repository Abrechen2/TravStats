import { Prisma } from "../../prisma";

import type { CountryTier } from "../../shared/countryEvidence";
import type { SettingsLevel } from "../../shared/settingsLevel";
import type { HomePeriod } from "../../utils/homeAirport";
import type { SuggestionSwitchesView } from "../../services/settings/suggestionSwitches";
import type { AccountPrefsView } from "../../services/settings/accountPrefs";

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
    /** The Companion keeps the profile zone in step with the device (ADR 0002 Q1, opt-in). */
    timezoneFollowsDevice?: boolean;
    dateFormat?: string;
    timeFormat?: string;
  };
  units?: {
    distanceUnit?: string;
    /** Unit of a bare baggage-allowance number (forgejo#186); absent = kg. */
    weightUnit?: string;
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
  /** Home periods — residence + home airports by date. See backend/src/utils/homeAirport.ts. */
  homePeriods?: HomePeriod[];
  /** The old one-airport list, written as a mirror of `homePeriods`' primaries. */
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
  /**
   * The zone that answers "today" for this account (ADR 0002 D4/Q1), read by
   * the server the same way every status and statistic reads it.
   * `hasProfileZone: false` means the account never confirmed one and "today"
   * is answered in UTC — the web asks at the next login (owner decision
   * 2026-09-26) instead of guessing from the browser.
   */
  profileZone: {
    zone: string;
    source: "profile" | "default-utc";
    hasProfileZone: boolean;
    followsDevice: boolean;
  };
  autoUpdate: AutoUpdateResponseSettings;
  boardingPassParserStrategy: string | null;
  historicalEnrichment: HistoricalEnrichmentResponseSettings;
  enabledDomains: string[];
  /** Read-only server capabilities, independent of the account selection. */
  availableDomains?: string[];
  baseCurrency: string;
  /** Silent trip auto-creation during flight import (column-backed). */
  autoCreateTrips: boolean;
  /** Inbox suggestion switches (forgejo#306), column-backed, nested here. */
  tripSuggestions: SuggestionSwitchesView["tripSuggestions"];
  staySuggestions: SuggestionSwitchesView["staySuggestions"];
  tripRecording: SuggestionSwitchesView["tripRecording"];
  /** Settings prototype rows (forgejo#321), column-backed, nested here. */
  tripDefaults: AccountPrefsView["tripDefaults"];
  cruiseSeaDays: AccountPrefsView["cruiseSeaDays"];
  liveTracking: AccountPrefsView["liveTracking"];
  railImport: AccountPrefsView["railImport"];
  /**
   * READ-ONLY mirror of the instance-level beta gate (AdminSettings row).
   * It is NOT part of the user's own settings and deliberately absent from
   * `settingsSchema`, so a PUT /settings carrying it is silently stripped by
   * Zod — only an admin can change it, via PUT /admin/instance-settings.
   */
  betaFeaturesEnabled: boolean;
  /**
   * READ-ONLY mirror of the instance's open data switch, like
   * `betaFeaturesEnabled`: the client needs it to decide whether to offer
   * weather, elevations and Wikipedia at all. Written only by an admin.
   */
  openDataEnabled: boolean;
  /**
   * READ-ONLY mirror of the instance's public share link switch (forgejo#281),
   * like `openDataEnabled`: a client offers "share as link" only when it is on.
   */
  shareLinksEnabled: boolean;
  /**
   * The user's OWN choice of which evidence tier the country headline counts
   * from, or null when they follow the instance (spec §3.2).
   *
   * Null is a real value here, not an absence: it means "keep tracking the
   * admin's default", so an account that never opened the setting still moves
   * when the admin changes their mind. Clearing the field must therefore send
   * an explicit `null`, which is why the Zod field is `.nullable()`.
   */
  countryThreshold: CountryTier | null;
  /**
   * READ-ONLY mirror of the instance default, like `betaFeaturesEnabled` above
   * and for a sharper reason: the UI has to NAME what applies when the user has
   * not chosen. "Standard der Instanz (Aufenthalt)" is only writable if the
   * client knows the word in the brackets.
   *
   * Deliberately absent from `settingsSchema`, so a PUT carrying it is stripped
   * by Zod — the write path is the admin-guarded PUT /admin/instance-settings.
   */
  instanceCountryThreshold: CountryTier;
  /**
   * Does this account have any track evidence at all — spec §3.4c.
   *
   * READ-ONLY, like the two fields above, and for the same kind of reason: the
   * country-counting control must not offer `transited` on an account where no
   * record can ever carry it. A choice whose every value yields the same number
   * does not read as an empty set, it reads as a bug.
   *
   * A boolean and not a count: it answers a layout question, not a statistical
   * one, and a number here would invite a client to draw it beside figures the
   * passport derives properly.
   */
  hasCountryTracks: boolean;
  /**
   * ISO 3166-1 alpha-2 home country, or null when not chosen. Orders booking
   * templates home market first; never filters them (plan 2026-10-09 P5).
   */
  homeCountry: string | null;
  /** How much of the settings page this account sees (forgejo#321). */
  settingsLevel: SettingsLevel;
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
  tripSuggestionsEnabled?: boolean;
  staySuggestionsEnabled?: boolean;
  staySuggestionsImmichEvidence?: boolean;
  staySuggestionsLlmPlaceClassification?: boolean;
  tripRecordingEnabled?: boolean;
  tripDefaultColor?: string | null;
  cruiseCountSeaDays?: boolean;
  flightLiveTrackingEnabled?: boolean;
  /** `null` clears the override and returns the user to the instance default. */
  countryThreshold?: CountryTier | null;
  /** `null` clears the home country. */
  homeCountry?: string | null;
  settingsLevel?: SettingsLevel;
}

export interface ParserSettingsUpdateData {
  visionProvider?: string;
  textProvider?: string;
}

export interface ApiKeysUpdateData {
  airlabsApiKey?: string | null;
  aviationstackApiKey?: string | null;
  aerodataboxApiKey?: string | null;
  aeroapiApiKey?: string | null;
  adsbxApiKey?: string | null;
  adsblolApiKey?: string | null;
  openskyClientId?: string | null;
  openskyClientSecret?: string | null;
  openskyUsername?: string | null;
  openskyPassword?: string | null;
  openrouteserviceApiKey?: string | null;
  graphhopperApiKey?: string | null;
}

export interface UserApiKeySettings {
  airlabsApiKey: string | null;
  aviationstackApiKey: string | null;
  aerodataboxApiKey: string | null;
  aeroapiApiKey: string | null;
  adsbxApiKey: string | null;
  adsblolApiKey: string | null;
  openskyClientId: string | null;
  openskyClientSecret: string | null;
  openskyUsername: string | null;
  openskyPassword: string | null;
  openrouteserviceApiKey: string | null;
  graphhopperApiKey: string | null;
}

export interface PrismaErrorWithCode extends Error {
  code?: string;
}

/**
 * The e-mail address older default blobs carried, and migration
 * 20261020171000 wrote into every account that had no settings row. It is
 * masked on read rather than rewritten: it means "no address", nothing else.
 */
export const PLACEHOLDER_PROFILE_EMAIL = "traveler@example.com";

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
//
// `profile` carries no `username` and no `email`: the username is the `User`
// row's, and an address nobody entered is unknown, not "traveler@example.com".
// Both used to be placeholders here, which every client then showed as the
// account's own data (audit F-002). Rows written before that still hold them —
// see `PLACEHOLDER_PROFILE_EMAIL` and buildSettingsResponse.
export const defaultSettings = {
  profile: {
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
