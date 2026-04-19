import { create } from "zustand";
import { persist } from "zustand/middleware";
import { settingsApi } from "../lib/api";
import { logger } from "../lib/logger";
import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";
import { useAuthStore } from "./authStore";

type ThemePreference = "light" | "dark";
type LanguagePreference = "de" | "en";
type DistanceUnit = "kilometers" | "miles" | "nautical_miles";
type Currency = "EUR" | "USD" | "GBP" | "CHF";
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
  apiKeys: ApiKeysStatus | null;
  enabledDomains: DomainKey[];
  setProfile: SettingsUpdater<ProfileSettings>;
  setDisplay: SettingsUpdater<DisplaySettings>;
  setUnits: SettingsUpdater<UnitsSettings>;
  setDefaults: SettingsUpdater<DefaultsSettings>;
  setMap: SettingsUpdater<MapSettings>;
  setNotifications: SettingsUpdater<NotificationSettings>;
  setFeatures: SettingsUpdater<FeaturesSettings>;
  setApiKeys: (status: ApiKeysStatus) => void;
  setEnabledDomains: (keys: DomainKey[]) => void;
  loadApiKeysStatus: () => Promise<void>;
  resetSettings: () => void;
  loadRemoteSettings: () => Promise<void>;
  saveRemoteSettings: () => Promise<void>;
}

const defaultSettings: Omit<
  SettingsState,
  | "setProfile"
  | "setDisplay"
  | "setUnits"
  | "setDefaults"
  | "setMap"
  | "setNotifications"
  | "setFeatures"
  | "setApiKeys"
  | "setEnabledDomains"
  | "loadApiKeysStatus"
  | "resetSettings"
  | "loadRemoteSettings"
  | "saveRemoteSettings"
> = {
  profile: {
    username: "Traveler",
    email: "traveler@example.com",
    profilePicture: undefined,
  },
  display: {
    theme: "light",
    language: "en",
    timezone: "Europe/Berlin",
    dateFormat: "DD.MM.YYYY",
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
  },
  apiKeys: null,
  enabledDomains: ["flight"],
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
              const newState = {
                ...state,
                ...remoteWithoutDirectFields,
              };
              // If profile username is still the default "Traveler", use the
              // actual account username from the auth store instead.
              if (newState.profile?.username === "Traveler") {
                const authUser = useAuthStore.getState().user;
                if (authUser?.username) {
                  newState.profile = { ...newState.profile, username: authUser.username };
                }
              }
              // Sync language to i18n if it changed (will be handled by App.tsx useEffect, but we do it here too for immediate update)
              if (remote.display?.language && remote.display.language !== state.display.language) {
                // The language sync will be handled by the useEffect in App.tsx
                // No need to import i18n here to avoid circular dependencies
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
