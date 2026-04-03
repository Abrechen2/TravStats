import { Prisma } from '@prisma/client';

// ---- Interfaces for settings data stored as JSON ----

export interface OnboardingState {
  flightAdded: boolean;
  usedFilter: boolean;
  exported: boolean;
  mapExplored: boolean;
  statsViewed: boolean;
  achievementsViewed: boolean;
  dismissed: boolean;
}

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
  privacy?: {
    twoFactorAuth?: boolean;
    loginAlerts?: boolean;
    dataExportRequested?: boolean;
    accountDeletionRequested?: boolean;
    analyticsOptIn?: boolean;
  };
  backup?: {
    autoBackup?: boolean;
    backupInterval?: string;
    exportFormat?: string;
    cloudSync?: boolean;
  };
  onboarding?: OnboardingState;
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
  maxAgeYears: number;
  autoProcess: boolean;
  maxPerDay: number;
  requireApproval: boolean;
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
  historicalEnrichmentMaxAgeYears?: number;
  historicalEnrichmentAutoProcess?: boolean;
  historicalEnrichmentMaxPerDay?: number;
  historicalEnrichmentRequireApproval?: boolean;
  boardingPassParserStrategy?: string | null;
}

export interface ParserSettingsUpdateData {
  preferredVisionParser?: string;
  preferredTextParser?: string;
  visionFallbackChain?: string;
  textFallbackChain?: string;
  openaiApiKey?: string | null;
  claudeApiKey?: string | null;
}

export interface DeveloperModeUpdateData {
  developerModeEnabled: boolean;
  developerModeConfirmedAt?: Date | null;
}

export interface TrainingSettingsUpdateData {
  useTrainedModels?: boolean;
  preferredEmailModel?: string;
  preferredVisionModel?: string;
}

export interface ApiKeysUpdateData {
  openaiApiKey?: string | null;
  claudeApiKey?: string | null;
  airlabsApiKey?: string | null;
  aviationstackApiKey?: string | null;
  openskyClientId?: string | null;
  openskyClientSecret?: string | null;
  openskyUsername?: string | null;
  openskyPassword?: string | null;
}

export interface UserApiKeySettings {
  openaiApiKey: string | null;
  claudeApiKey: string | null;
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

// Shared default settings used across sub-routers
export const defaultSettings = {
  profile: { username: 'Traveler', email: 'traveler@example.com', profilePicture: null },
  display: { theme: 'light', language: 'de', timezone: 'Europe/Berlin', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  units: { distanceUnit: 'kilometers', currency: 'EUR' },
  defaults: { flightStatus: 'scheduled', seatClass: 'economy', favoriteAirline: 'Lufthansa', flightCategory: 'business' },
  map: { mapStyle: 'osm', zoomLevel: 3, markerStyle: 'pin', routeColor: '#2563eb' },
  notifications: { emailNotifications: true, flightReminder: '24h', checkInReminder: true, featureUpdates: true },
  privacy: { twoFactorAuth: false, loginAlerts: true, dataExportRequested: false, accountDeletionRequested: false, analyticsOptIn: false },
  backup: { autoBackup: false, backupInterval: 'weekly', exportFormat: 'json', cloudSync: false },
};
