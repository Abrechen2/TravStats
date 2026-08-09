import type { DomainKey } from "../../shared/domains";
import type { ParsedBooking } from "../../types";

// ==================== Shared / Reusable Interfaces ====================

/** Provider availability metadata (used in parser provider endpoints) */
export interface ProviderAvailabilityMetadata {
  model?: string;
  models?: string[];
  version?: string;
  [key: string]: unknown;
}

/** Provider availability entry */
export interface ProviderAvailability {
  available: boolean;
  reason?: string;
  metadata?: ProviderAvailabilityMetadata;
}

/** Parser correction result entry (flight-level data submitted for feedback) */
export interface ParserCorrectionEntry {
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  seat?: string;
  seatClass?: string;
  gate?: string;
  terminal?: string;
  airline?: string;
  bookingReference?: string;
  ticketNumber?: string;
  boardingGroup?: string;
}

/** Parser correction submission payload */
export interface ParserCorrectionPayload {
  sourceType: "email" | "boardingpass";
  provider: string;
  originalResult: ParserCorrectionEntry[];
  correctedResult: ParserCorrectionEntry[];
  originalData?: {
    subject?: string;
    text?: string;
    html?: string;
  };
}

/** Parse result for boarding pass */
export interface BoardingPassParseResult {
  flight: ParsedBooking;
  enriched?: boolean;
  provider?: string;
  confidence?: number;
}

/** Parse result for email/email file */
export interface EmailParseResult {
  flights: ParsedBooking[];
  provider?: string;
  subject?: string;
  text?: string;
  html?: string;
  airlineNotice?: string | null;
}

/** Generic message response */
export interface MessageResponse {
  message: string;
}

/** Generic success response */
export interface SuccessResponse {
  success: boolean;
  message: string;
}

/** API key test response */
export interface ApiKeyTestResponse {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

// ==================== Settings Interfaces ====================

export interface AutoUpdateSettings {
  enabled: boolean;
  requireApproval: boolean;
  checkInterval: number;
  onlyDuringFlight: boolean;
  expiryHours: number;
}

export interface HistoricalEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

export interface UserSettings {
  profile?: {
    username?: string;
    email?: string;
    profilePicture?: string;
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
  notifications?: {
    flightReminder?: string;
  };
  autoUpdate?: AutoUpdateSettings;
  historicalEnrichment?: HistoricalEnrichmentSettings;
  enabledDomains?: DomainKey[];
  whatsNewSeenVersion?: string;
  /** ISO 4217 alpha-3 code. The user's real base currency (see `UserSettings.baseCurrency`
   * on the backend) — used to convert/aggregate money figures like lodging spend. Distinct
   * from `units.currency`, a separate display preference. */
  baseCurrency?: string;
  /**
   * Instance-level beta gate — READ-ONLY. Served by GET /settings for
   * convenience; PUT /settings ignores it (Zod strips it server-side). Only
   * an admin can write it, via PUT /admin/instance-settings.
   */
  betaFeaturesEnabled?: boolean;
  [key: string]: unknown;
}

// ==================== Training Interfaces ====================

export interface TrainingDataEntry {
  id: string;
  type: "email" | "boarding_pass";
  status: "pending" | "trained" | "failed";
  annotations?: Record<string, unknown>;
  extractedData?: unknown[];
  extractedDataCount?: number;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  filename?: string;
  fileSize?: number;
}

export interface TrainingUploadResult {
  id: string;
  type: string;
  status: string;
  message?: string;
}

export interface TrainingAnnotationResult {
  success: boolean;
  message?: string;
  templateId?: string;
}

// ==================== Pending Updates Interfaces ====================

export interface FlightUpdateChange {
  field: string;
  type: "added" | "removed" | "changed";
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
}

export interface PendingUpdateFlightRef {
  id: string;
  flightNumber: string | null;
  airline: string | null;
  departureTime: string;
  arrivalTime: string;
  depIata: string | null;
  arrIata: string | null;
}

export interface StatisticsImpact {
  distanceChange?: number;
  durationChange?: number;
  [key: string]: unknown;
}

/** Flight update data for pending updates (key-value pairs of flight fields) */
export type FlightUpdateData = Record<string, string | number | boolean | null | undefined>;

export interface PendingUpdate {
  id: string;
  flightId: string;
  userId: string;
  status: "pending" | "applied" | "rejected" | "expired" | "edited";
  originalData: FlightUpdateData;
  proposedData: FlightUpdateData;
  editedData?: FlightUpdateData;
  changes: FlightUpdateChange[];
  editedChanges?: FlightUpdateChange[];
  apiSource: string;
  fetchedAt: string;
  expiresAt: string;
  appliedAt?: string;
  rejectedAt?: string;
  editedAt?: string;
  statisticsImpact?: StatisticsImpact;
  flight?: PendingUpdateFlightRef;
}

// ==================== Log / Feedback Interfaces ====================

export interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  context?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  requestId?: string;
  error?: Record<string, unknown>;
}

export interface LogSearchResult {
  filename: string;
  timestamp: string;
  level: string;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ParserFeedbackEntry {
  id: string;
  userId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

// ==================== Backup Interfaces ====================

export interface BackupMetadata {
  dbSize?: number;
  filesSize?: number;
  tables?: Record<string, number>;
  version?: string;
  [key: string]: unknown;
}

export interface BackupEntry {
  id: string;
  type: string;
  status: string;
  backupPath: string;
  dbBackupPath: string | null;
  filesBackupPath: string | null;
  size: string;
  retentionDays: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  metadata: BackupMetadata | null;
  syncedToCloud: boolean;
  cloudSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  fileExists?: boolean;
}

// ==================== Export Data Interface ====================

export interface ExportAllDataResponse {
  users: Array<Record<string, unknown>>;
  flights: Array<Record<string, unknown>>;
  achievements: Array<Record<string, unknown>>;
  settings: Array<Record<string, unknown>>;
  exportedAt: string;
  version: string;
}

// ==================== Email Notification Interfaces ====================

export interface SmtpConfigInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

export interface SmtpConfigResponse {
  configured?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
  enabled?: boolean;
}

export interface NotificationPreferences {
  notificationEmail: string | null;
  notifyBefore24h: boolean;
  notifyBefore2h: boolean;
}

// ==================== Stats-specific Types ====================

/** Full summary stats shape returned by /stats/summary */
export interface SummaryStats {
  totalFlights: number;
  totalDistance: number;
  totalFlightTime: number;
  avgDistance: number;
  byStatus: Record<string, number>;
  byAirline: Record<string, number>;
  totalCost: number;
  byCategory: Record<string, number>;
}

/** Response when compareYear is also provided */
export interface SummaryCompareResponse {
  current: SummaryStats;
  compare: SummaryStats;
}

export type SummaryResponse = SummaryStats | SummaryCompareResponse;

export interface SummaryParams {
  fromDate?: string;
  toDate?: string;
  year?: number;
  compareYear?: number;
}

// ==================== Timeseries Types ====================

export interface TimeseriesPoint {
  period: string; // "YYYY-MM" | "YYYY"
  count: number;
  distanceKm: number;
  durationMin: number;
}

export interface TimeseriesTotals {
  count: number;
  distanceKm: number;
  durationMin: number;
}

export interface TimeseriesResponse {
  domain: "flight" | "cruise";
  granularity: "month" | "year";
  window: { from: string; to: string };
  series: TimeseriesPoint[];
  current: TimeseriesTotals;
  previous: TimeseriesTotals;
}

export interface TimeseriesParams {
  domain?: "flight" | "cruise";
  granularity?: "month" | "year";
  window?: "rolling12m" | "year" | "all";
  year?: number;
  fromDate?: string;
  toDate?: string;
}

// ==================== Airport Interface ====================

export interface Airport {
  id?: number;
  iata?: string;
  icao?: string;
  name: string;
  city?: string;
  country?: string;
  lat: number;
  lon: number;
  altitude?: number;
  timezone?: string;
  /** True if the airport is permanently closed (e.g. Berlin Tegel TXL). */
  isClosed?: boolean;
  /** Manually added via the admin master-data page (#191); survives re-seeds. */
  isUserAdded?: boolean;
}

// ==================== Template Interfaces ====================

export interface TemplateStatusEntry {
  iata: string;
  airline: string;
  version: string;
  source: "builtin" | "cached";
}

export interface TemplateStatusResult {
  templates: TemplateStatusEntry[];
  total: number;
  githubRepo: string;
}

export interface UserTemplateItem {
  id: string;
  name: string;
  status: "pending" | "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  stats?: { matchCount: number; successRate: number; lastUsedAt?: string };
}
