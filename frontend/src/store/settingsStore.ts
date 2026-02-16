import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsApi } from '../lib/api';
import { logger } from '../lib/logger';

type ThemePreference = 'light' | 'dark';
type LanguagePreference = 'de' | 'en';
type DistanceUnit = 'kilometers' | 'miles' | 'nautical_miles';
type Currency = 'EUR' | 'USD' | 'GBP' | 'CHF';
type FlightCategory = 'business' | 'private' | 'vacation';
type SeatClass = 'economy' | 'premium_economy' | 'business' | 'first';

type FlightReminder = 'off' | '24h' | '48h';
type BackupInterval = 'daily' | 'weekly' | 'monthly';
type ExportFormat = 'json' | 'csv' | 'pdf';

type MapStyle = 'osm' | 'satellite';
type MarkerStyle = 'pin' | 'circle' | 'custom';

type DateFormat = 'DD.MM.YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
type TimeFormat = '24h' | '12h';

type FlightStatusDefault = 'scheduled' | 'flown';
type BoardingPassParserStrategy = 'parser-only' | 'parser-with-api' | 'api-only' | null;

type SettingsUpdater<T> = (updates: Partial<T>) => void;

export interface ProfileSettings {
  username: string;
  email: string;
  profilePicture?: string;
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
  emailNotifications: boolean;
  flightReminder: FlightReminder;
  checkInReminder: boolean;
  featureUpdates: boolean;
}

export interface PrivacySettings {
  twoFactorAuth: boolean;
  loginAlerts: boolean;
  dataExportRequested: boolean;
  accountDeletionRequested: boolean;
  analyticsOptIn?: boolean;
}

export interface BackupSettings {
  autoBackup: boolean;
  backupInterval: BackupInterval;
  exportFormat: ExportFormat;
  cloudSync: boolean;
}

export interface ApiKeyStatus {
  hasKey: boolean;
  isShared: boolean;
  hasAccess: boolean;
}

export interface ApiKeysStatus {
  openai: ApiKeyStatus;
  claude: ApiKeyStatus;
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
  privacy: PrivacySettings;
  backup: BackupSettings;
  apiKeys: ApiKeysStatus | null;
  boardingPassParserStrategy: BoardingPassParserStrategy;
  setProfile: SettingsUpdater<ProfileSettings>;
  setDisplay: SettingsUpdater<DisplaySettings>;
  setUnits: SettingsUpdater<UnitsSettings>;
  setDefaults: SettingsUpdater<DefaultsSettings>;
  setMap: SettingsUpdater<MapSettings>;
  setNotifications: SettingsUpdater<NotificationSettings>;
  setPrivacy: SettingsUpdater<PrivacySettings>;
  setBackup: SettingsUpdater<BackupSettings>;
  setApiKeys: (status: ApiKeysStatus) => void;
  setBoardingPassParserStrategy: (strategy: BoardingPassParserStrategy) => void;
  loadApiKeysStatus: () => Promise<void>;
  resetSettings: () => void;
  loadRemoteSettings: () => Promise<void>;
  saveRemoteSettings: () => Promise<void>;
}

const defaultSettings: Omit<
  SettingsState,
  'setProfile' | 'setDisplay' | 'setUnits' | 'setDefaults' | 'setMap' | 'setNotifications' | 'setPrivacy' | 'setBackup' | 'setApiKeys' | 'setBoardingPassParserStrategy' | 'loadApiKeysStatus' | 'resetSettings' | 'loadRemoteSettings' | 'saveRemoteSettings'
> = {
  profile: {
    username: 'Traveler',
    email: 'traveler@example.com',
    profilePicture: undefined,
  },
  display: {
    theme: 'light',
    language: 'en',
    timezone: 'Europe/Berlin',
    dateFormat: 'DD.MM.YYYY',
    timeFormat: '24h',
  },
  units: {
    distanceUnit: 'kilometers',
    currency: 'EUR',
  },
  defaults: {
    flightStatus: 'scheduled',
    seatClass: 'economy',
    favoriteAirline: 'Lufthansa',
    flightCategory: 'business',
  },
  map: {
    mapStyle: 'osm',
    zoomLevel: 3,
    markerStyle: 'pin',
    routeColor: '#2563eb',
  },
  notifications: {
    emailNotifications: true,
    flightReminder: '24h',
    checkInReminder: true,
    featureUpdates: true,
  },
  privacy: {
    twoFactorAuth: false,
    loginAlerts: true,
    dataExportRequested: false,
    accountDeletionRequested: false,
    analyticsOptIn: false,
  },
  backup: {
    autoBackup: false,
    backupInterval: 'weekly',
    exportFormat: 'json',
    cloudSync: false,
  },
  apiKeys: null,
  boardingPassParserStrategy: null, // null = auto (LLM wenn verfügbar)
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
      setPrivacy: (updates) =>
        set((state) => ({
          privacy: { ...state.privacy, ...updates },
        })),
      setBackup: (updates) =>
        set((state) => ({
          backup: { ...state.backup, ...updates },
        })),
      setApiKeys: (status) =>
        set(() => ({
          apiKeys: status,
        })),
      setBoardingPassParserStrategy: (strategy) =>
        set(() => ({
          boardingPassParserStrategy: strategy,
        })),
      loadApiKeysStatus: async () => {
        try {
          const status = await settingsApi.getApiKeys();
          set({ apiKeys: status });
        } catch (error) {
          logger.warn('Failed to load API keys status', error);
        }
      },
      resetSettings: () => set(defaultSettings),
      loadRemoteSettings: async () => {
        try {
          const remote = await settingsApi.get();
          if (remote) {
            set((state) => {
              // Extract autoUpdate and historicalEnrichment to exclude them from store
              const remoteRecord = remote as Record<string, unknown>;
              const { autoUpdate: _au, historicalEnrichment: _he, ...remoteWithoutDirectFields } = remoteRecord;
              const newState = {
                ...state,
                ...remoteWithoutDirectFields,
              };
              // Set boarding pass parser strategy if present
              if (remote.boardingPassParserStrategy !== undefined) {
                newState.boardingPassParserStrategy = remote.boardingPassParserStrategy;
              }
              // Sync language to i18n if it changed (will be handled by App.tsx useEffect, but we do it here too for immediate update)
              if (remote.display?.language && remote.display.language !== state.display.language) {
                // The language sync will be handled by the useEffect in App.tsx
                // No need to import i18n here to avoid circular dependencies
              }
              return newState;
            });
          }
        } catch (error) {
          logger.warn('Failed to load remote settings, using local defaults', error);
        }
      },
      saveRemoteSettings: async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { resetSettings, loadRemoteSettings, saveRemoteSettings, ...rest } = get();
          // Don't send autoUpdate and historicalEnrichment as they are managed separately
          await settingsApi.update(rest);
        } catch (error) {
          logger.warn('Failed to save settings remotely', error);
        }
      },
    }),
    {
      name: 'settings-storage',
    }
  )
);
