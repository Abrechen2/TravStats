import { create } from "zustand";
import { persist } from "zustand/middleware";
import { settingsApi } from "../lib/api";
import { logger } from "../lib/logger";
import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";
import { useAuthStore } from "./authStore";

type ThemePreference = "light" | "dark";
type LanguagePreference = "de" | "en";
type DistanceUnit = "kilometers" | "miles" | "nautical_miles";
/** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …). */
type Currency = string;
type FlightCategory = "business" | "private" | "vacation";
type SeatClass = "economy" | "premium_economy" | "business" | "first";

type FlightReminder = "off" | "24h" | "48h";

type MapStyle = "osm" | "satellite";
type MarkerStyle = "pin" | "circle" | "custom";

type DateFormat = "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
type TimeFormat = "24h" | "12h";

type FlightStatusDefault = "scheduled" | "flown";

type SettingsUpdater<T> = (updates: Partial<T>) => void;

export interface ProfileSettings {
  username: string;
  email: string;
  profilePicture?: string;
  /**
   * ISO date string (YYYY-MM-DD) or null when unset. User-level field
   * stored on the User row, not in the settings JSON — loaded and saved
   * via the dedicated /settings/profile endpoint. Powers the
   * BIRTHDAY_FLIGHT achievement.
   */
  birthdate?: string | null;
}

export interface DisplaySettings {
  theme: ThemePreference;
  language: LanguagePreference;
  timezone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
}

export interface UnitsSettings {
  distanceUnit: DistanceUnit;
  currency: Currency;
}

export interface DefaultsSettings {
  flightStatus: FlightStatusDefault;
  seatClass: SeatClass;
  favoriteAirline: string;
  flightCategory: FlightCategory;
}

export interface MapSettings {
  mapStyle: MapStyle;
  zoomLevel: number;
  markerStyle: MarkerStyle;
  routeColor: string;
}

export interface NotificationSettings {
  flightReminder: FlightReminder;
}

export interface FeaturesSettings {
  enableCostTracking: boolean;
  /**
   * Persist tail number / Mode-S identifiers from flight lookups.
   * Default ON. Off = the form drops aircraftRegistration + Mode-S
   * before submit, so the database column stays NULL even though the
   * lookup returned data. Lets privacy-conscious users keep flight
   * stats without an audit trail of specific airframes they've flown.
   */
  trackAircraftRegistration: boolean;
}

/**
 * Cruise-domain preferences that pre-fill the cruise entry form and
 * shape the cruise map layer. Lives in its own slice so future
 * cruise-specific fields don't mix with flight-specific ones. The
 * same pattern will apply when hotel / POI domains ship — each gets
 * its own nested slice, never flat keys like `cruiseDefaultLine`.
 */
export interface CruiseSettings {
  /** Prefilled in "Neue Kreuzfahrt → Manuell" when the ship field is empty. */
  defaultLine: string;
  /** Prefilled cabin category on new cruises. `null` = no default. */
  defaultCabinType: "inside" | "oceanview" | "balcony" | "suite" | null;
  /** Toggles the cruise arc layer in the dashboard map. */
  showCruiseArcs: boolean;
}

export interface ApiKeyStatus {
  hasKey: boolean;
  isShared: boolean;
  hasAccess: boolean;
}

export interface ApiKeysStatus {
  airlabs: ApiKeyStatus;
  aviationstack: ApiKeyStatus;
  opensky: ApiKeyStatus;
}

export interface SettingsState {
  profile: ProfileSettings;
  display: DisplaySettings;
  units: UnitsSettings;
  defaults: DefaultsSettings;
  map: MapSettings;
  notifications: NotificationSettings;
  features: FeaturesSettings;
  cruise: CruiseSettings;
  apiKeys: ApiKeysStatus | null;
  enabledDomains: DomainKey[];
  /**
   * The user's actual base currency (`UserSettings.baseCurrency`, ECB rate
   * applied per stay's check-in day) — used by the backend to compute
   * `spendBaseTotal` / `totalSpendBase` figures in the lodging domain. This is
   * NOT `units.currency` (a separate, user-configurable *display* preference
   * for flight-cost figures elsewhere) — the two are independent and must
   * not be conflated when labeling a base-currency figure.
   */
  baseCurrency: string;
  setProfile: SettingsUpdater<ProfileSettings>;
  setDisplay: SettingsUpdater<DisplaySettings>;
  setUnits: SettingsUpdater<UnitsSettings>;
  setDefaults: SettingsUpdater<DefaultsSettings>;
  setMap: SettingsUpdater<MapSettings>;
  setNotifications: SettingsUpdater<NotificationSettings>;
  setFeatures: SettingsUpdater<FeaturesSettings>;
  setCruise: SettingsUpdater<CruiseSettings>;
  setApiKeys: (status: ApiKeysStatus) => void;
  setEnabledDomains: (keys: DomainKey[]) => void;
  loadApiKeysStatus: () => Promise<void>;
  resetSettings: () => void;
  loadRemoteSettings: () => Promise<void>;
  saveRemoteSettings: () => Promise<void>;
}

// Browser-aware fallbacks for display fields that the backend no longer
// seeds on a fresh install (issue #87). Run once at module load; safe to
// call before the i18n module is fully wired since they only touch
// navigator/Intl.
const detectInitialLanguage = (): LanguagePreference => {
  if (typeof navigator === "undefined") return "en";
  const tag = navigator.language?.split("-")[0];
  return tag === "de" ? "de" : "en";
};
const detectInitialTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
};
const detectInitialDateFormat = (): DateFormat => {
  if (typeof navigator === "undefined") return "DD.MM.YYYY";
  const region = navigator.language?.toLowerCase();
  if (region?.startsWith("en-us")) return "MM/DD/YYYY";
  if (region?.startsWith("en")) return "YYYY-MM-DD";
  return "DD.MM.YYYY";
};

const defaultSettings: Omit<
  SettingsState,
  | "setProfile"
  | "setDisplay"
  | "setUnits"
  | "setDefaults"
  | "setMap"
  | "setNotifications"
  | "setFeatures"
  | "setCruise"
  | "setApiKeys"
  | "setEnabledDomains"
  | "loadApiKeysStatus"
  | "resetSettings"
  | "loadRemoteSettings"
  | "saveRemoteSettings"
> = {
  profile: {
    username: "",
    email: "",
    profilePicture: undefined,
  },
  display: {
    theme: "light",
    language: detectInitialLanguage(),
    timezone: detectInitialTimezone(),
    dateFormat: detectInitialDateFormat(),
    timeFormat: "24h",
  },
  units: {
    distanceUnit: "kilometers",
    currency: "EUR",
  },
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
    flightReminder: "24h",
  },
  features: {
    enableCostTracking: false,
    trackAircraftRegistration: true,
  },
  cruise: {
    defaultLine: "",
    defaultCabinType: null,
    showCruiseArcs: true,
  },
  apiKeys: null,
  enabledDomains: ["flight"],
  baseCurrency: "EUR",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      setProfile: (updates) =>
        set((state) => ({
          profile: { ...state.profile, ...updates },
        })),
      setDisplay: (updates) =>
        set((state) => ({
          display: { ...state.display, ...updates },
        })),
      setUnits: (updates) =>
        set((state) => ({
          units: { ...state.units, ...updates },
        })),
      setDefaults: (updates) =>
        set((state) => ({
          defaults: { ...state.defaults, ...updates },
        })),
      setMap: (updates) =>
        set((state) => ({
          map: { ...state.map, ...updates },
        })),
      setNotifications: (updates) =>
        set((state) => ({
          notifications: { ...state.notifications, ...updates },
        })),
      setFeatures: (updates) => set((state) => ({ features: { ...state.features, ...updates } })),
      setCruise: (updates) => set((state) => ({ cruise: { ...state.cruise, ...updates } })),
      setApiKeys: (status) =>
        set(() => ({
          apiKeys: status,
        })),
      setEnabledDomains: (keys) => {
        set({ enabledDomains: keys });
        void settingsApi.update({ enabledDomains: keys });
      },
      loadApiKeysStatus: async () => {
        try {
          const status = await settingsApi.getApiKeys();
          set({ apiKeys: status });
        } catch (error) {
          logger.warn("Failed to load API keys status", error);
        }
      },
      resetSettings: () => set(defaultSettings),
      loadRemoteSettings: async () => {
        // birthdate lives on the User row, not in UserSettings JSON — so
        // it rides on a parallel request. Failure here is non-fatal:
        // the rest of the profile still loads.
        try {
          const { birthdate } = await settingsApi.getProfile();
          set((state) => ({
            ...state,
            profile: { ...state.profile, birthdate },
          }));
        } catch (error) {
          logger.warn("Failed to load user profile (birthdate)", error);
        }
        try {
          const remote = await settingsApi.get();
          if (remote) {
            set((state) => {
              // Extract autoUpdate and historicalEnrichment to exclude them from store
              const remoteRecord = remote as Record<string, unknown>;
              /* eslint-disable @typescript-eslint/no-unused-vars */
              const {
                autoUpdate: _au,
                historicalEnrichment: _he,
                privacy: _privacy,
                backup: _backup,
                ...remoteWithoutDirectFields
              } = remoteRecord;
              /* eslint-enable @typescript-eslint/no-unused-vars */
              // Shallow-merge each settings group instead of replacing it
              // wholesale. The backend's seed defaults intentionally omit
              // browser-detectable fields (display.language / timezone /
              // dateFormat — see issue #87) so local detection survives
              // the first post-login fetch. A blind top-level spread would
              // wipe state.display.language back to undefined whenever the
              // remote payload's display object lacks the key.
              const mergeGroup = <K extends keyof SettingsState>(key: K) => {
                const remoteGroup = remoteWithoutDirectFields[key as string];
                if (remoteGroup && typeof remoteGroup === "object") {
                  return { ...(state[key] as object), ...(remoteGroup as object) };
                }
                return state[key];
              };
              const newState: SettingsState = {
                ...state,
                profile: mergeGroup("profile") as ProfileSettings,
                display: mergeGroup("display") as DisplaySettings,
                units: mergeGroup("units") as UnitsSettings,
                defaults: mergeGroup("defaults") as DefaultsSettings,
                map: mergeGroup("map") as MapSettings,
                notifications: mergeGroup("notifications") as NotificationSettings,
                features: mergeGroup("features") as FeaturesSettings,
              };
              // Always mirror the auth-store username into profile.username.
              // If the persisted username belongs to a different account
              // (previous login still in localStorage), also drop the
              // email + profile picture so we don't leak them across users.
              // Also scrub the legacy "traveler@example.com" placeholder
              // that shipped as a default in earlier builds and got
              // autosaved into real UserSettings rows.
              const authUser = useAuthStore.getState().user;
              if (authUser?.username) {
                const previousUsername = state.profile?.username ?? "";
                const userChanged =
                  previousUsername !== "" && previousUsername !== authUser.username;
                const incomingEmail = newState.profile?.email ?? "";
                const email =
                  userChanged || incomingEmail === "traveler@example.com" ? "" : incomingEmail;
                newState.profile = {
                  ...newState.profile,
                  username: authUser.username,
                  email,
                  ...(userChanged ? { profilePicture: undefined } : {}),
                };
              }
              // Validate enabledDomains against the known domain keys —
              // drop anything the frontend doesn't understand (e.g. a
              // future domain the backend knows about but we don't yet).
              if (Array.isArray(remote.enabledDomains)) {
                const filtered = remote.enabledDomains.filter((k): k is DomainKey =>
                  (DOMAIN_KEYS as readonly string[]).includes(k as string)
                );
                newState.enabledDomains = filtered;
              }
              // baseCurrency is a plain top-level field (like enabledDomains),
              // not part of any of the settings-group objects merged above.
              if (typeof remote.baseCurrency === "string" && remote.baseCurrency.length > 0) {
                newState.baseCurrency = remote.baseCurrency;
              }
              return newState;
            });
          }
        } catch (error) {
          logger.warn("Failed to load remote settings, using local defaults", error);
        }
      },
      saveRemoteSettings: async () => {
        try {
          const {
            profile,
            display,
            units,
            defaults,
            map,
            notifications,
            features,
            cruise,
            enabledDomains,
          } = get();
          await settingsApi.update({
            profile,
            display,
            units,
            defaults,
            map,
            notifications,
            features,
            cruise,
            enabledDomains,
          });
          // birthdate lives on a separate endpoint (/settings/profile on the
          // User row). Only PUT when the field was explicitly loaded or set
          // — undefined means "not touched this session, leave backend as-is".
          if (profile.birthdate !== undefined) {
            await settingsApi.updateProfile({ birthdate: profile.birthdate });
          }
        } catch (error) {
          logger.warn("Failed to save settings remotely", error);
        }
      },
    }),
    {
      name: "settings-storage",
      // Strip removed fields from persisted state so stale localStorage doesn't crash the app
      migrate: (persisted: unknown) => {
        const s = { ...(persisted as Record<string, unknown>) };
        delete s["privacy"];
        delete s["backup"];
        return s;
      },
    }
  )
);
